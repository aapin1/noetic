import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchSupadataTranscript } from "@/server/supadata";

function fakeResponse(status: number, json: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => json,
    text: async () => JSON.stringify(json),
  } as unknown as Response;
}

const LONG = "A transcript that is comfortably longer than the forty-character floor for real speech.";

beforeEach(() => {
  vi.stubEnv("SUPADATA_API_KEY", "sd-test");
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("fetchSupadataTranscript", () => {
  it("returns content from a synchronous 200", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeResponse(200, { lang: "en", content: LONG })));
    await expect(fetchSupadataTranscript("https://www.tiktok.com/@a/video/1", "auto")).resolves.toBe(LONG);
  });

  it("polls a 202 job until it completes", async () => {
    let polls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (url.includes("/v1/transcript?")) return fakeResponse(202, { jobId: "job-1" });
      if (url.endsWith("/v1/transcript/job-1")) {
        polls++;
        return polls < 2 ? fakeResponse(200, { status: "active" }) : fakeResponse(200, { status: "completed", content: LONG });
      }
      return fakeResponse(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const pending = fetchSupadataTranscript("https://www.instagram.com/reel/abc/", "auto");
    await vi.advanceTimersByTimeAsync(3100); // first poll: active
    await vi.advanceTimersByTimeAsync(3100); // second poll: completed
    await expect(pending).resolves.toBe(LONG);
    expect(polls).toBe(2);
    expect(log).not.toHaveBeenCalled();
  });

  it("treats the 206 transcript-unavailable body as a miss and logs it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeResponse(206, { error: "transcript-unavailable", message: "No transcript" })));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(fetchSupadataTranscript("https://www.tiktok.com/@a/video/1", "native")).resolves.toBeUndefined();
    expect(JSON.parse(String(log.mock.calls[0][0]))).toMatchObject({ event: "supadata_miss", failure: "http_206", error: "transcript-unavailable" });
  });

  it("retries a 429 once after a pause, then reports limit-exceeded", async () => {
    const fetchMock = vi.fn(async () => fakeResponse(429, { error: "limit-exceeded", message: "quota" }));
    vi.stubGlobal("fetch", fetchMock);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const pending = fetchSupadataTranscript("https://www.tiktok.com/@a/video/1", "auto");
    await vi.advanceTimersByTimeAsync(2600);
    await expect(pending).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(log.mock.calls[0][0]))).toMatchObject({ event: "supadata_miss", failure: "http_429", error: "limit-exceeded" });
  });

  it("recovers when the 429 was a burst rate limit", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse(429, { error: "limit-exceeded" }))
      .mockResolvedValueOnce(fakeResponse(200, { content: LONG }));
    vi.stubGlobal("fetch", fetchMock);
    const pending = fetchSupadataTranscript("https://www.tiktok.com/@a/video/1", "auto");
    await vi.advanceTimersByTimeAsync(2600);
    await expect(pending).resolves.toBe(LONG);
  });

  it("drops a speechless clip's few words as short_text", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeResponse(200, { content: "We'll see you next time." })));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(fetchSupadataTranscript("https://www.tiktok.com/@a/video/1", "auto")).resolves.toBeUndefined();
    expect(JSON.parse(String(log.mock.calls[0][0]))).toMatchObject({ event: "supadata_miss", failure: "short_text", chars: 24 });
  });
});
