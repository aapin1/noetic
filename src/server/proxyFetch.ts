import { randomBytes } from "node:crypto";
import { ProxyAgent, fetch as undiciFetch } from "undici";

/**
 * Residential-proxy fetch for hosts that bot-wall datacenter IPs (YouTube,
 * bot-guarded article sites, Reddit). RESIDENTIAL_PROXY_URL is a proxy URL
 * template, e.g. `http://user-{session}:pass@p.webshare.io:80`; the
 * `{session}` placeholder pins every request of one ProxySession to the same
 * exit IP (YouTube's caption URLs are IP-bound to whoever fetched the watch
 * page). Env-gated: without the var, sessions fall back to plain fetch, so
 * local dev — which runs on residential IPs anyway — is unchanged.
 */
export type ProxySession = {
  /** True when requests actually go through the proxy. */
  viaProxy: boolean;
  fetch: (
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string; redirect?: RequestRedirect },
    timeoutMs?: number,
  ) => Promise<Response>;
  /** Release proxy sockets. Call after all response bodies are consumed. */
  close: () => Promise<void>;
};

const DEFAULT_TIMEOUT_MS = 12000;

export function createProxySession(): ProxySession {
  const template = process.env.RESIDENTIAL_PROXY_URL?.trim();

  if (!template) {
    return {
      viaProxy: false,
      fetch: async (url, init = {}, timeoutMs = DEFAULT_TIMEOUT_MS) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          return await fetch(url, { ...init, signal: controller.signal });
        } finally {
          clearTimeout(timer);
        }
      },
      close: async () => {},
    };
  }

  const token = randomBytes(6).toString("hex");
  const agent = new ProxyAgent(template.replaceAll("{session}", token));

  return {
    viaProxy: true,
    fetch: async (url, init = {}, timeoutMs = DEFAULT_TIMEOUT_MS) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        // undici's fetch, not the (Next-patched) global: Next overrides the
        // global dispatcher, so per-request ProxyAgent only works here.
        const res = await undiciFetch(url, {
          ...init,
          dispatcher: agent,
          signal: controller.signal,
        });
        return res as unknown as Response;
      } finally {
        clearTimeout(timer);
      }
    },
    close: () => agent.close(),
  };
}
