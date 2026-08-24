import { assertPublicHttpUrl } from "@/server/ssrf";
import { FETCH_TIMEOUT_MS, ProviderError, USER_AGENT } from "./types";

/**
 * The one place a connection reaches the network. Every URL is built from
 * provider constants plus a validated handle, but the SSRF gate is cheap and
 * this is exactly the class of fetch it exists for.
 */
export async function providerFetch(
  url: string,
  init: RequestInit & { providerName: string },
): Promise<Response> {
  await assertPublicHttpUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      headers: { "user-agent": USER_AGENT, ...(init.headers ?? {}) },
      signal: controller.signal,
      redirect: init.redirect ?? "follow",
    });
  } catch {
    throw new ProviderError(
      "UNAVAILABLE",
      `${init.providerName} isn't answering right now — try again in a bit`,
      503,
    );
  } finally {
    clearTimeout(timer);
  }
}
