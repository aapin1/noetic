import type { ProxySession } from "@/server/proxyFetch";

const GROQ_TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const OPENAI_TRANSCRIBE_URL = "https://api.openai.com/v1/audio/transcriptions";

/** Groq's and OpenAI's per-file cap is 25MB; staying under it also bounds proxy bandwidth. */
export const MAX_AUDIO_BYTES = 24 * 1024 * 1024;

export type AsrProvider = "groq" | "openai";

/** Whether the Groq ASR tier is available. Env-gated like SUPADATA_API_KEY:
 * without GROQ_API_KEY every caller silently skips this tier. */
export function groqConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY);
}

/** Whether any ASR provider is available (Groq preferred, OpenAI whisper-1
 * as the backstop — the same key the voice-note path already uses). */
export function asrConfigured(): boolean {
  return groqConfigured() || Boolean(process.env.OPENAI_API_KEY);
}

/** YouTube's CDN only serves media reads that START AT BYTE 0, and rejects
 * bounds much past 256KB (measured 2026-07: offset-0 reads ≤256KB pass; any
 * non-zero offset and ~512KB+ bounds 403 — YouTube is pushing clients toward
 * its UMP streaming protocol, and plain-URL chunking no longer works). So one
 * bounded leading read is all we get: the complete audio for Shorts at the
 * lowest bitrate, or the opening ~minute of longer videos. Hosts that ignore
 * Range (TikTok CDNs) return 200 with the full body instead. */
const MAX_LEADING_BYTES = 256 * 1024;

/**
 * Makes a truncated fragmented-MP4 audio read decodable: cuts at the last
 * complete top-level box, zeroes the container's duration claims (mvhd/tkhd/
 * mdhd/mehd — a leading read still declares the FULL video duration, which
 * made Groq's decoder hang waiting for ~13 minutes of samples that aren't
 * there), and drops sidx boxes that index byte ranges beyond the cut. The
 * decoder then derives the real duration from the fragments present.
 * Non-MP4 input is returned untouched.
 */
function repairTruncatedMp4(input: ArrayBuffer): ArrayBuffer {
  const bytes = new Uint8Array(input.slice(0));
  const view = new DataView(bytes.buffer);
  const type = (o: number) => String.fromCharCode(bytes[o + 4], bytes[o + 5], bytes[o + 6], bytes[o + 7]);
  if (bytes.byteLength < 8 || type(0) !== "ftyp") return input;

  const boxSize = (o: number, end: number): number | undefined => {
    if (o + 8 > end) return undefined;
    let size = view.getUint32(o);
    if (size === 1) {
      if (o + 16 > end) return undefined;
      size = view.getUint32(o + 8) * 2 ** 32 + view.getUint32(o + 12);
    }
    return size < 8 || o + size > end ? undefined : size;
  };

  const zero = (o: number, len: number) => bytes.fill(0, o, o + len);
  const CONTAINERS = new Set(["moov", "trak", "mdia", "mvex"]);
  const walk = (start: number, end: number) => {
    let off = start;
    for (let size = boxSize(off, end); size !== undefined; off += size, size = boxSize(off, end)) {
      const t = type(off);
      const body = off + (view.getUint32(off) === 1 ? 16 : 8);
      const v1 = bytes[body] === 1;
      if (t === "mvhd" || t === "tkhd") zero(v1 ? body + 28 : body + 20, v1 ? 8 : 4);
      else if (t === "mdhd") zero(v1 ? body + 24 : body + 16, v1 ? 8 : 4);
      else if (t === "mehd") zero(body + 4, v1 ? 8 : 4);
      else if (CONTAINERS.has(t)) walk(body, off + size);
    }
  };
  walk(0, bytes.byteLength);

  // Keep only complete top-level boxes, skipping sidx.
  const parts: Uint8Array[] = [];
  let off = 0;
  for (let size = boxSize(off, bytes.byteLength); size !== undefined; off += size, size = boxSize(off, bytes.byteLength)) {
    if (type(off) !== "sidx") parts.push(bytes.subarray(off, off + size));
  }
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  if (total === 0) return input;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.byteLength;
  }
  return out.buffer;
}

async function downloadLeadingAudio(args: {
  url: string;
  session?: ProxySession;
  headers?: Record<string, string>;
  downloadTimeoutMs?: number;
}): Promise<{ audio: ArrayBuffer; partial: boolean } | { failure: string }> {
  const timeoutMs = args.downloadTimeoutMs ?? 30000;
  const headers = { ...args.headers, range: `bytes=0-${MAX_LEADING_BYTES - 1}` };
  const res = args.session
    ? await args.session.fetch(args.url, { headers }, timeoutMs)
    : await fetch(args.url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) return { failure: `download_http_${res.status}` };
  const audio = await res.arrayBuffer();
  if (audio.byteLength === 0) return { failure: "empty_body" };
  if (audio.byteLength > MAX_AUDIO_BYTES) return { failure: "too_large" };
  if (res.status !== 206) return { audio, partial: false }; // Range ignored: full body
  // "bytes 0-262143/4864941" — the suffix is the full file size.
  const total = Number(/\/(\d+)\s*$/.exec(res.headers.get("content-range") ?? "")?.[1]);
  const partial = Number.isFinite(total) && total > audio.byteLength;
  return { audio: partial ? repairTruncatedMp4(audio) : audio, partial };
}

const missLog = (host: string, failure: string, provider?: AsrProvider) => {
  // One structured line per miss (never on success) so prod logs show exactly
  // why the ASR tier came up empty — a silent undefined here is how the
  // Supadata fallback's failures went unnoticed.
  console.log(JSON.stringify({ event: "asr_miss", host, failure, ...(provider ? { provider } : {}) }));
  return undefined;
};

async function transcribeWith(
  provider: AsrProvider,
  audio: ArrayBuffer,
  filename: string,
): Promise<{ text: string } | { failure: string }> {
  const apiKey = provider === "groq" ? process.env.GROQ_API_KEY : process.env.OPENAI_API_KEY;
  if (!apiKey) return { failure: "unconfigured" };
  const form = new FormData();
  form.append("model", provider === "groq" ? "whisper-large-v3-turbo" : "whisper-1");
  form.append("response_format", "text");
  form.append("file", new Blob([audio]), filename);
  try {
    const res = await fetch(provider === "groq" ? GROQ_TRANSCRIBE_URL : OPENAI_TRANSCRIBE_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) return { failure: `http_${res.status}` };
    return { text: (await res.text()).replace(/\s+/g, " ").trim() };
  } catch (error) {
    return { failure: `exception_${error instanceof Error ? error.name : "unknown"}` };
  }
}

/**
 * Transcribes an in-memory media file. Groq's whisper-large-v3-turbo first
 * (benchmarked 2026-07 at WER 0.036 against Supadata's AI transcription on
 * the same clip, ~$0.04/hour of audio); OpenAI's whisper-1 (~$0.36/hour)
 * takes over when Groq is unconfigured or its request fails. A too-short
 * result is a property of the media (no speech), not the provider, so it is
 * not retried elsewhere. Best-effort: undefined on any failure.
 */
export async function transcribeBuffer(
  audio: ArrayBuffer,
  filename: string,
  host: string,
): Promise<{ text: string; provider: AsrProvider } | { failure: string }> {
  const providers: AsrProvider[] = ["groq", "openai"];
  let failure = "no_provider";
  for (const provider of providers) {
    const result = await transcribeWith(provider, audio, filename);
    if ("failure" in result) {
      if (result.failure !== "unconfigured") missLog(host, result.failure, provider);
      failure = result.failure;
      continue;
    }
    if (result.text.length >= 40) return { text: result.text, provider };
    // The media was decoded fine and simply has (almost) no speech — that is
    // a fact about the clip, so callers can skip every other ASR tier.
    missLog(host, "short_text", provider);
    return { failure: "short_text" };
  }
  if (failure === "no_provider") missLog(host, failure);
  return { failure };
}

/**
 * Downloads a media file (size-guarded, leading-bytes read) and transcribes
 * it. `partial` is true when the host only let us read the leading bytes of
 * a longer file (see downloadLeadingAudio) — the transcript then covers the
 * opening of the media, not all of it.
 *
 * The download runs through the caller's proxy session when provided: YouTube
 * streaming URLs are IP-bound to whoever requested the player data, so the
 * fetch must come from the same exit IP.
 */
export async function transcribeAudioUrl(args: {
  url: string;
  session?: ProxySession;
  /** Sent on the media download. YouTube 403s stream URLs unless the
   * user-agent matches the InnerTube client that requested the player data. */
  headers?: Record<string, string>;
  /** Groq sniffs the container from the filename extension. */
  filename?: string;
  downloadTimeoutMs?: number;
}): Promise<{ text: string; partial: boolean } | undefined> {
  if (!asrConfigured()) return undefined;
  const host = new URL(args.url).hostname;
  try {
    const download = await downloadLeadingAudio(args);
    if ("failure" in download) return missLog(host, download.failure);
    const result = await transcribeBuffer(download.audio, args.filename ?? "audio.mp4", host);
    return "failure" in result ? undefined : { text: result.text, partial: download.partial };
  } catch (error) {
    return missLog(host, `exception_${error instanceof Error ? error.name : "unknown"}`);
  }
}

/**
 * Downloads a COMPLETE media file and transcribes it — for hosts whose CDNs
 * serve whole files to anyone holding the URL (TikTok, Instagram). Unlike
 * transcribeAudioUrl there is no Range header: these CDNs honour Range, so
 * a leading read would silently transcribe only the first ~10 seconds.
 *
 * The download is tried directly first (free) and repeated through the
 * residential proxy session only when the direct read is refused — media
 * CDNs rarely bot-wall, so this keeps proxy bandwidth (the real per-capture
 * cost) near zero. Size-guarded at MAX_AUDIO_BYTES; the caller should pick
 * the lowest-bitrate rendition it can.
 */
export async function transcribeMediaUrl(args: {
  url: string;
  session?: ProxySession;
  headers?: Record<string, string>;
  filename?: string;
  downloadTimeoutMs?: number;
}): Promise<{ text: string; provider: AsrProvider; viaProxy: boolean } | { failure: string }> {
  if (!asrConfigured()) return { failure: "unconfigured" };
  const host = new URL(args.url).hostname;
  const timeoutMs = args.downloadTimeoutMs ?? 30000;
  const headers = args.headers ?? {};

  const attempt = async (viaProxy: boolean): Promise<{ audio: ArrayBuffer; viaProxy: boolean } | { failure: string }> => {
    try {
      const res = viaProxy
        ? await args.session!.fetch(args.url, { headers }, timeoutMs)
        : await fetch(args.url, { headers, signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) return { failure: `download_http_${res.status}` };
      const declared = Number(res.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > MAX_AUDIO_BYTES) return { failure: "too_large" };
      const audio = await res.arrayBuffer();
      if (audio.byteLength === 0) return { failure: "empty_body" };
      if (audio.byteLength > MAX_AUDIO_BYTES) return { failure: "too_large" };
      return { audio, viaProxy };
    } catch (error) {
      return { failure: `exception_${error instanceof Error ? error.name : "unknown"}` };
    }
  };

  let download = await attempt(false);
  if ("failure" in download && download.failure !== "too_large" && args.session?.viaProxy) {
    download = await attempt(true);
  }
  if ("failure" in download) {
    missLog(host, download.failure);
    return { failure: download.failure };
  }

  const result = await transcribeBuffer(download.audio, args.filename ?? "video.mp4", host);
  return "failure" in result ? result : { ...result, viaProxy: download.viaProxy };
}
