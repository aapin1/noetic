import { afterEach, describe, expect, it, vi } from "vitest";
import { createProxySession } from "@/server/proxyFetch";

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
});
