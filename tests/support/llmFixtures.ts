/**
 * Deterministic replay for the OpenAI calls in `src/server/cognition/llm.ts`
 * and `src/server/transcribe.ts`.
 *
 * Every LLM-backed behaviour in this app (classification, insight polish,
 * tension detection, terrain narrative) is non-deterministic and costs money
 * per run, which makes it useless as a test oracle. This intercepts `fetch` at
 * the boundary and keys each request on a hash of (url, method, body), so the
 * same prompt always yields the same response.
 *
 * Modes, via `LLM_FIXTURES`:
 *   replay (default) — serve from tests/fixtures/llm; a miss is a hard error.
 *   record           — call the real API and write the response to disk.
 *   off              — no interception at all.
 *
 * Production code is untouched: this only ever swaps `globalThis.fetch`.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const FIXTURE_DIR = path.resolve(__dirname, "../fixtures/llm");
const OPENAI_HOST = "api.openai.com";

export type FixtureMode = "replay" | "record" | "off";

type FixtureFile = {
  /** Human-readable provenance so a fixture can be reviewed without decoding a hash. */
  request: {
    url: string;
    endpoint: string;
    model: string | null;
    summary: string;
  };
  response: {
    status: number;
    body: unknown;
  };
};

export function fixtureMode(): FixtureMode {
  const raw = process.env.LLM_FIXTURES;
  if (raw === "record" || raw === "off") return raw;
  return "replay";
}

/** Which OpenAI endpoint a URL belongs to — only used to name fixture files. */
function endpointOf(url: string): string {
  if (url.includes("/embeddings")) return "embed";
  if (url.includes("/audio/transcriptions")) return "transcribe";
  if (url.includes("/chat/completions")) return "chat";
  return "other";
}

/**
 * Canonical string for a request. `FormData` (Whisper uploads) can't be
 * stringified directly, so binary parts collapse to their byte length — two
 * different audio files of the same length would collide, which is acceptable
 * for a fixture key and impossible in practice across a handful of clips.
 */
async function canonicalBody(body: BodyInit | null | undefined): Promise<string> {
  if (body == null) return "";
  if (typeof body === "string") return body;

  if (typeof FormData !== "undefined" && body instanceof FormData) {
    const parts: string[] = [];
    for (const [key, value] of [...body.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      parts.push(typeof value === "string" ? `${key}=${value}` : `${key}=<blob:${value.size}>`);
    }
    return parts.join("&");
  }

  if (body instanceof ArrayBuffer) return `<buffer:${body.byteLength}>`;
  if (ArrayBuffer.isView(body)) return `<buffer:${body.byteLength}>`;
  return String(body);
}

function summarize(endpoint: string, parsedBody: unknown): { model: string | null; summary: string } {
  if (typeof parsedBody !== "object" || parsedBody === null) {
    return { model: null, summary: endpoint };
  }
  const body = parsedBody as {
    model?: unknown;
    input?: unknown;
    messages?: { role?: string; content?: unknown }[];
  };
  const model = typeof body.model === "string" ? body.model : null;

  if (endpoint === "embed") {
    const input = typeof body.input === "string" ? body.input : "";
    return { model, summary: input.slice(0, 160) };
  }

  // For chat, the last user message is what actually distinguishes one call
  // from another — the system prompt is near-identical across a given helper.
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const lastUser = [...messages].reverse().find((m) => m?.role === "user");
  const content = lastUser?.content;
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .map((p) => (typeof p === "object" && p && "text" in p ? String((p as { text: unknown }).text) : ""))
            .join(" ")
        : "";
  return { model, summary: text.slice(0, 160) };
}

async function fixtureKey(url: string, method: string, body: BodyInit | null | undefined) {
  const canonical = await canonicalBody(body);
  const hash = createHash("sha256").update(`${method.toUpperCase()} ${url}\n${canonical}`).digest("hex");

  let parsed: unknown = null;
  try {
    parsed = canonical.startsWith("{") ? JSON.parse(canonical) : null;
  } catch {
    parsed = null;
  }

  const endpoint = endpointOf(url);
  const { model, summary } = summarize(endpoint, parsed);
  const modelSlug = (model ?? "none").replace(/[^a-z0-9.-]/gi, "-");

  return {
    id: hash.slice(0, 16),
    file: path.join(FIXTURE_DIR, `${endpoint}-${modelSlug}-${hash.slice(0, 16)}.json`),
    endpoint,
    model,
    summary,
  };
}

/**
 * Embeddings dominate fixture size (1536 floats each, ~30KB at full precision).
 * Six decimals is far below any threshold cosine similarity cares about and
 * cuts each file to roughly a third.
 */
function shrinkEmbeddings(payload: unknown): unknown {
  if (typeof payload !== "object" || payload === null) return payload;
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return payload;

  return {
    ...(payload as object),
    data: data.map((row) => {
      if (typeof row !== "object" || row === null) return row;
      const embedding = (row as { embedding?: unknown }).embedding;
      if (!Array.isArray(embedding)) return row;
      return { ...row, embedding: embedding.map((n) => Number(Number(n).toFixed(6))) };
    }),
  };
}

/**
 * Every LLM helper in llm.ts wraps its fetch in `try { … } catch { return null }`
 * so a flaky API degrades instead of failing a capture. That is right in
 * production and ruinous in a test: a thrown "no fixture" error would be
 * swallowed and the pipeline would quietly run its keyword fallback, so the
 * suite would go green while testing nothing.
 *
 * So misses are also recorded here, out of reach of those catch blocks, and the
 * suite asserts the list is empty after each test (see setup-db.ts).
 */
const misses: string[] = [];

/** Drains the recorded misses. Empty means every LLM call was served. */
export function takeFixtureMisses(): string[] {
  return misses.splice(0, misses.length);
}

function missError(key: Awaited<ReturnType<typeof fixtureKey>>): Error {
  const detail = [
    `[llm-fixtures] No recorded response for this ${key.endpoint} call.`,
    `  key:     ${key.id}`,
    `  model:   ${key.model ?? "(none)"}`,
    `  prompt:  ${key.summary.replace(/\s+/g, " ").slice(0, 120)}`,
    ``,
    `  The prompt changed, or this call is new. Re-record with:`,
    `    npm run test:db:record`,
    `  (uses the real OPENAI_API_KEY from .env.local and spends money on each miss)`,
  ].join("\n");

  misses.push(detail);
  return new Error(detail);
}

/**
 * Swaps `globalThis.fetch` for a fixture-aware version. Returns a restore fn.
 * Non-OpenAI requests pass straight through untouched.
 */
export function installLlmFixtures(): () => void {
  const mode = fixtureMode();
  if (mode === "off") return () => {};

  // Every helper in llm.ts short-circuits to null when OPENAI_API_KEY is unset,
  // so replay would silently exercise the fallback paths instead of the real
  // ones. A placeholder key keeps the code on its normal branch; the key is
  // never sent anywhere because replayed calls never leave the process.
  if (mode === "replay" && !process.env.OPENAI_API_KEY) {
    process.env.OPENAI_API_KEY = "sk-fixture-replay-placeholder";
  }

  const realFetch = globalThis.fetch.bind(globalThis);

  if (mode === "record" && !existsSync(FIXTURE_DIR)) {
    mkdirSync(FIXTURE_DIR, { recursive: true });
  }

  const patched: typeof globalThis.fetch = async (input, init) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;

    if (!url.includes(OPENAI_HOST)) return realFetch(input as RequestInfo, init);

    // All OpenAI calls in this codebase pass (urlString, init). A Request
    // object would hide the body from us, so refuse rather than guess.
    if (typeof input !== "string" && !(input instanceof URL)) {
      throw new Error("[llm-fixtures] Request-object fetch to OpenAI is not supported; pass (url, init).");
    }

    const method = init?.method ?? "GET";
    const key = await fixtureKey(url, method, init?.body);

    if (mode === "replay") {
      if (!existsSync(key.file)) throw missError(key);
      const fixture = JSON.parse(readFileSync(key.file, "utf8")) as FixtureFile;
      return new Response(JSON.stringify(fixture.response.body), {
        status: fixture.response.status,
        headers: { "content-type": "application/json" },
      });
    }

    // record: hit the real API, persist, and hand the caller a fresh Response
    // (the original is consumed by .json() here).
    const response = await realFetch(url, init);
    const text = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }

    const fixture: FixtureFile = {
      request: { url, endpoint: key.endpoint, model: key.model, summary: key.summary },
      response: { status: response.status, body: shrinkEmbeddings(body) },
    };
    writeFileSync(key.file, `${JSON.stringify(fixture, null, 2)}\n`);

    return new Response(JSON.stringify(fixture.response.body), {
      status: response.status,
      headers: { "content-type": "application/json" },
    });
  };

  globalThis.fetch = patched;
  return () => {
    globalThis.fetch = realFetch;
  };
}

/** How many fixtures are on disk — used by the fixture self-check test. */
export function fixtureCount(): number {
  if (!existsSync(FIXTURE_DIR)) return 0;
  return readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".json")).length;
}
