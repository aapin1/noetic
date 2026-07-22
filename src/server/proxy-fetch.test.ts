import http from "node:http";
import net, { type AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProxySession } from "@/server/proxyFetch";

/** An origin that answers 403 with a body, plus a forwarding HTTP proxy in
 * front of it — the shape every bot-walled host presents to a datacenter IP. */
async function startProxiedOrigin() {
  const origin = http.createServer((_req, res) => {
    res.writeHead(403, { "content-type": "text/html" });
    res.end("x".repeat(200_000));
  });
  await new Promise<void>((resolve) => origin.listen(0, "127.0.0.1", resolve));
  const originPort = (origin.address() as AddressInfo).port;

  // undici's ProxyAgent tunnels with CONNECT, so a plain forwarding handler is
  // never reached — the proxy has to splice raw sockets.
  const proxy = http.createServer((_req, res) => res.writeHead(405).end());
  proxy.on("connect", (_req, clientSocket, head) => {
    const upstream = net.connect(originPort, "127.0.0.1", () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head?.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on("error", () => clientSocket.destroy());
    clientSocket.on("error", () => upstream.destroy());
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const proxyPort = (proxy.address() as AddressInfo).port;

  return {
    proxyUrl: `http://127.0.0.1:${proxyPort}`,
    targetUrl: `http://127.0.0.1:${originPort}/blocked`,
    stop: async () => {
      // closeAllConnections: an abandoned response body leaves sockets open,
      // and a graceful close() would wait on them — the very thing under test.
      proxy.closeAllConnections();
      origin.closeAllConnections();
      await new Promise<void>((r) => proxy.close(() => r()));
      await new Promise<void>((r) => origin.close(() => r()));
    },
  };
}

describe("createProxySession", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("falls back to plain fetch when RESIDENTIAL_PROXY_URL is unset", async () => {
    vi.stubEnv("RESIDENTIAL_PROXY_URL", "");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const session = createProxySession();
    expect(session.viaProxy).toBe(false);

    const res = await session.fetch("https://example.com", { headers: { "x-test": "1" } });
    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({ headers: { "x-test": "1" }, signal: expect.any(AbortSignal) }),
    );
    await session.close();
  });

  it("reports viaProxy and closes cleanly when the proxy env is set", async () => {
    vi.stubEnv("RESIDENTIAL_PROXY_URL", "http://user-{session}:pass@127.0.0.1:9");
    const session = createProxySession();
    expect(session.viaProxy).toBe(true);
    // No request is made — just verify the agent lifecycle works.
    await expect(session.close()).resolves.not.toThrow();
  });

  it("aborts a hung request at the timeout", async () => {
    vi.stubEnv("RESIDENTIAL_PROXY_URL", "");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      ),
    );

    const session = createProxySession();
    await expect(session.fetch("https://example.com", {}, 20)).rejects.toThrow("aborted");
  });

  // The extraction ladder early-returns on every non-OK response without
  // reading its body (`if (!res.ok) return undefined`), and each call site
  // closes the session in a `finally`. A graceful close waits for those bodies
  // and therefore never resolves — which hung fetchMetadata forever, not
  // slowly. Rare from a residential IP, routine from a datacenter one.
  it("closes even when a non-OK response body was never consumed", async () => {
    const server = await startProxiedOrigin();
    try {
      vi.stubEnv("RESIDENTIAL_PROXY_URL", server.proxyUrl);
      const session = createProxySession();
      const res = await session.fetch(server.targetUrl);
      expect(res.status).toBe(403);
      // Deliberately no res.text()/arrayBuffer() — this is the bug's trigger.
      await expect(
        Promise.race([
          session.close().then(() => "closed"),
          new Promise((resolve) => setTimeout(() => resolve("hung"), 3000)),
        ]),
      ).resolves.toBe("closed");
    } finally {
      await server.stop();
    }
  });
});
