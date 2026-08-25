import { condenseToBudget, fetchWithTimeout } from "@/server/extract-util";

export type SupadataMode = "native" | "auto";

const ENDPOINT = "https://api.supadata.ai/v1/transcript";
const POLL_INTERVAL_MS = 3000;
/** AI transcription of a short video is queued as a job; give it this long
 * end to end before treating it as a miss. */
const AUTO_DEADLINE_MS = 60000;

type SupadataPayload = {
  content?: unknown;
  jobId?: string;
  status?: string;
  error?: string;
  message?: string;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Supadata transcript API — the paid backstop for video/social content.
 * `mode=native` fetches existing captions only (1 credit); `mode=auto` falls
 * back to AI transcription (2 credits/min). Env-gated: without
 * SUPADATA_API_KEY this tier is silently skipped.
 *
 * Contract details that used to be swallowed as a silent `undefined`
 * (found 2026-08-24 against real TikTok/Instagram captures):
 * - AI transcription can answer **202 + jobId** — the transcript arrives via
 *   `GET /v1/transcript/{jobId}` polling, never in the first response.
 * - `transcript-unavailable` comes back as **206** (a 2xx, so `res.ok`
 *   is true) with an error body instead of content.
 * - **429 limit-exceeded** covers both a per-second rate limit and the
 *   plan's monthly quota; one paused retry separates the two.
 * Every miss logs a structured `supadata_miss` line so prod shows why.
 */
export async function fetchSupadataTranscript(url: string, mode: SupadataMode): Promise<string | undefined> {
  const apiKey = process.env.SUPADATA_API_KEY;
  if (!apiKey) return undefined;

  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "?";
    }
  })();
  const miss = (failure: string, extra: Record<string, unknown> = {}) => {
    console.log(JSON.stringify({ event: "supadata_miss", host, mode, failure, ...extra }));
    return undefined;
  };

  const headers = { "x-api-key": apiKey };
  const requestTimeoutMs = mode === "native" ? 8000 : 20000;
  const deadline = Date.now() + (mode === "native" ? requestTimeoutMs : AUTO_DEADLINE_MS);

  try {
    const endpoint = `${ENDPOINT}?url=${encodeURIComponent(url)}&text=true&mode=${mode}&lang=en`;
    let res = await fetchWithTimeout(endpoint, { headers }, requestTimeoutMs);
    if (res.status === 429) {
      await sleep(2500);
      res = await fetchWithTimeout(endpoint, { headers }, requestTimeoutMs);
    }

    let payload = (await res.json().catch(() => ({}))) as SupadataPayload;
    if (!res.ok || payload.error) {
      return miss(`http_${res.status}`, { error: payload.error, message: payload.message });
    }

    if (typeof payload.content !== "string" && typeof payload.jobId === "string") {
      const job = await pollJob(payload.jobId, headers, deadline);
      if ("failure" in job) return miss(job.failure, { error: job.error });
      payload = job.payload;
    }

    if (typeof payload.content !== "string") return miss("no_content");
    const text = payload.content.replace(/\s+/g, " ").trim();
    return text.length >= 40 ? condenseToBudget(text) : miss("short_text", { chars: text.length });
  } catch (error) {
    return miss(`exception_${error instanceof Error ? error.name : "unknown"}`);
  }
}

async function pollJob(
  jobId: string,
  headers: Record<string, string>,
  deadline: number,
): Promise<{ payload: SupadataPayload } | { failure: string; error?: string }> {
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const res = await fetchWithTimeout(`${ENDPOINT}/${encodeURIComponent(jobId)}`, { headers }, 10000);
    const payload = (await res.json().catch(() => ({}))) as SupadataPayload;
    if (!res.ok) return { failure: `job_http_${res.status}`, error: payload.error };
    if (payload.status === "failed") return { failure: "job_failed", error: payload.error };
    if (typeof payload.content === "string") return { payload };
    // queued / active: keep waiting
  }
  return { failure: "job_timeout" };
}
