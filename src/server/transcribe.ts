import type { ProxySession } from "@/server/proxyFetch";

const GROQ_TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

/** Groq's per-file cap is 25MB; staying under it also bounds proxy bandwidth. */
const MAX_AUDIO_BYTES = 24 * 1024 * 1024;

/** Whether the Groq ASR tier is available. Env-gated like SUPADATA_API_KEY:
 * without GROQ_API_KEY every caller silently skips this tier. */
export function groqConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY);
}

/**
 * Downloads a media file (size-guarded) and transcribes it with Groq's hosted
 * whisper-large-v3-turbo. Benchmarked 2026-07 at WER 0.036 against Supadata's
 * AI transcription on the same clip, at ~$0.04/hour of audio — roughly 17x
 * cheaper than Supadata mode=auto (2 credits/min).
 *
 * The download runs through the caller's proxy session when provided: YouTube
 * streaming URLs are IP-bound to whoever requested the player data, so the
 * fetch must come from the same exit IP. Best-effort: undefined on any failure.
 */
export async function transcribeAudioUrl(args: {
  url: string;
  session?: ProxySession;
  /** Groq sniffs the container from the filename extension. */
  filename?: string;
  downloadTimeoutMs?: number;
}): Promise<string | undefined> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return undefined;

  try {
    const timeoutMs = args.downloadTimeoutMs ?? 30000;
    const res = args.session
      ? await args.session.fetch(args.url, {}, timeoutMs)
      : await fetch(args.url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return undefined;
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > MAX_AUDIO_BYTES) return undefined;
    const audio = await res.arrayBuffer();
    if (audio.byteLength === 0 || audio.byteLength > MAX_AUDIO_BYTES) return undefined;

    const form = new FormData();
    form.append("model", "whisper-large-v3-turbo");
    form.append("response_format", "text");
    form.append("file", new Blob([audio]), args.filename ?? "audio.mp4");

    const groqRes = await fetch(GROQ_TRANSCRIBE_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(60000),
    });
    if (!groqRes.ok) return undefined;

    const text = (await groqRes.text()).replace(/\s+/g, " ").trim();
    return text.length >= 40 ? text : undefined;
  } catch {
    return undefined;
  }
}
