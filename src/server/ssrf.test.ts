import { describe, expect, it, vi } from "vitest";

const lookup = vi.hoisted(() => vi.fn());
vi.mock("node:dns/promises", () => ({ lookup }));

import { AppError } from "@/lib/api";
import { assertPublicHttpUrl } from "./ssrf";

/** Pretend DNS: every hostname resolves to the given addresses. */
function resolvesTo(...addresses: string[]) {
  lookup.mockResolvedValue(addresses.map((address) => ({ address, family: 4 })));
}

describe("assertPublicHttpUrl", () => {
  it("allows an ordinary public URL", async () => {
    resolvesTo("93.184.216.34");
    await expect(assertPublicHttpUrl("https://example.com/article")).resolves.toBeInstanceOf(URL);
  });

  it.each([
    ["file:///etc/passwd"],
    ["gopher://example.com/"],
    ["data:text/html,hello"],
    ["ftp://example.com/file"],
  ])("rejects the non-http protocol %s", async (input) => {
    await expect(assertPublicHttpUrl(input)).rejects.toThrow(AppError);
  });

  it("rejects a malformed URL", async () => {
    await expect(assertPublicHttpUrl("not a url")).rejects.toThrow(AppError);
  });

  describe("IP literals, which never reach the resolver", () => {
    it.each([
      ["http://127.0.0.1:5432/", "loopback"],
      ["http://10.0.0.5/", "private class A"],
      ["http://172.16.4.4/", "private class B"],
      ["http://192.168.1.1/", "private class C"],
      ["http://169.254.169.254/latest/meta-data/", "cloud metadata"],
      ["http://100.64.0.1/", "carrier-grade NAT"],
      ["http://0.0.0.0/", "this network"],
      ["http://[::1]/", "IPv6 loopback"],
      ["http://[fd00::1]/", "IPv6 unique-local"],
      ["http://[fe80::1]/", "IPv6 link-local"],
      ["http://[::ffff:127.0.0.1]/", "IPv4-mapped loopback, dotted-quad spelling"],
      // `new URL()` rewrites the line above into this one, so a check that only
      // recognized the dotted-quad form let the same address through.
      ["http://[::ffff:7f00:1]/", "IPv4-mapped loopback, hex spelling"],
      ["http://[::ffff:a00:1]/", "IPv4-mapped private, hex spelling"],
    ])("rejects %s (%s)", async (input) => {
      await expect(assertPublicHttpUrl(input)).rejects.toThrow(AppError);
      expect(lookup).not.toHaveBeenCalled();
    });

    it("allows a public IP literal", async () => {
      await expect(assertPublicHttpUrl("http://93.184.216.34/")).resolves.toBeInstanceOf(URL);
    });

    it("allows a public IPv6 literal", async () => {
      await expect(assertPublicHttpUrl("http://[2606:2800:220:1:248:1893:25c8:1946]/")).resolves.toBeInstanceOf(URL);
    });
  });

  // Checking the hostname text alone is defeated by any attacker-controlled
  // domain with an A record pointing inside our network.
  it("rejects a public-looking hostname that resolves to a private address", async () => {
    resolvesTo("127.0.0.1");
    await expect(assertPublicHttpUrl("https://totally-legit.example/")).rejects.toThrow(AppError);
  });

  it("rejects when only one of several resolved addresses is private", async () => {
    resolvesTo("93.184.216.34", "10.1.2.3");
    await expect(assertPublicHttpUrl("https://split-horizon.example/")).rejects.toThrow(AppError);
  });

  it("rejects a host that resolves to nothing at all", async () => {
    lookup.mockResolvedValue([]);
    await expect(assertPublicHttpUrl("https://empty.example/")).rejects.toThrow(AppError);
  });

  // An unresolvable host is usually just a dead link; let the fetch fail on its
  // own terms rather than reporting it as a blocked URL.
  it("passes through when resolution fails outright", async () => {
    lookup.mockRejectedValue(new Error("ENOTFOUND"));
    await expect(assertPublicHttpUrl("https://nonexistent.example/")).resolves.toBeInstanceOf(URL);
  });

  it("does not name the reason a URL was blocked", async () => {
    // A precise message ("that host is internal") turns this into a scanner for
    // our private network.
    const error: unknown = await assertPublicHttpUrl("http://192.168.0.1/").catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).message).not.toMatch(/internal|private|localhost|network/i);
  });
});
