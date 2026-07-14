import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchMetadata, parseMetadataFromHtml, scoreContentConfidence } from "@/server/metadata";

describe("scoreContentConfidence", () => {
  it("scores substantive body text as rich", () => {
    expect(scoreContentConfidence({ bodyText: "x".repeat(900) })).toBe("rich");
  });

  it("scores short body or description as partial", () => {
    expect(scoreContentConfidence({ bodyText: "x".repeat(200) })).toBe("partial");
    expect(scoreContentConfidence({ description: "d".repeat(200) })).toBe("partial");
  });

  it("scores title-only content as thin", () => {
    expect(scoreContentConfidence({})).toBe("thin");
    expect(scoreContentConfidence({ bodyText: "tiny", description: "also tiny" })).toBe("thin");
  });
});

describe("JSON-LD extraction", () => {
  it("uses articleBody when the DOM has no readable body", () => {
    const article = "A substantive argument about attention and memory. ".repeat(10);
    const html = `
      <html><head>
        <meta property="og:title" content="Essay" />
        <script type="application/ld+json">${JSON.stringify({ "@type": "NewsArticle", articleBody: article })}</script>
      </head><body></body></html>
    `;
    const metadata = parseMetadataFromHtml(html, "https://example.com/essay");
    expect(metadata.bodyText).toContain("substantive argument");
    expect(metadata.bodySource).toBe("jsonld");
  });

  it("falls back to long-form JSON-LD description (podcast show notes)", () => {
    const notes = "In this episode we cover the history of writing systems, from cuneiform to the alphabet, and what each transition did to human memory.";
    const html = `
      <html><head>
        <meta property="og:title" content="Episode 12" />
        <script type="application/ld+json">${JSON.stringify({ "@type": "PodcastEpisode", description: notes })}</script>
      </head><body></body></html>
    `;
    const metadata = parseMetadataFromHtml(html, "https://podcasts.apple.com/us/podcast/x/id1");
    expect(metadata.bodyText).toBe(notes);
    expect(metadata.bodySource).toBe("jsonld");
  });
});

describe("Readability body extraction", () => {
  it("extracts article text the heuristic misses (content in divs)", () => {
    const sentence = "Writing is thinking made visible, and most advice about it is secretly advice about thinking. ";
    const html = `
      <html><head><title>Notes on writing</title><meta property="og:title" content="Notes on writing" /></head>
      <body>
        <nav><a href="/">Home</a><a href="/about">About</a></nav>
        <div id="content">
          <div>${sentence.repeat(4)}</div>
          <div>${sentence.repeat(4)}</div>
          <div>${sentence.repeat(4)}</div>
        </div>
        <footer>Subscribe to the newsletter</footer>
      </body></html>
    `;
    const metadata = parseMetadataFromHtml(html, "https://example.com/writing");
    expect(metadata.bodyText).toContain("thinking made visible");
    expect(metadata.bodySource).toBe("body");
  });

  it("condenses long bodies to budget, keeping the head, middle, and tail", () => {
    const opening = `<p>OPENING-THESIS ${"the essay begins with its central claim about memory. ".repeat(3)}</p>`;
    const filler = `<p>${"A long essay paragraph that keeps going with substantive content. ".repeat(3)}</p>`;
    const closing = `<p>CLOSING-ARGUMENT ${"the essay ends by resolving the claim it opened with. ".repeat(3)}</p>`;
    const html = `
      <html><head><meta property="og:title" content="Long essay" /></head>
      <body><article>${opening}${filler.repeat(120)}${closing}</article></body></html>
    `;
    const metadata = parseMetadataFromHtml(html, "https://example.com/long");
    expect(metadata.bodyText!.length).toBeGreaterThan(6000);
    expect(metadata.bodyText!.length).toBeLessThanOrEqual(12000);
    expect(metadata.bodyText).toContain("OPENING-THESIS");
    expect(metadata.bodyText).toContain("CLOSING-ARGUMENT");
    expect(metadata.bodyText).toContain("[…]");
  });

  it("still prefers JSON-LD articleBody when it is the longest extraction", () => {
    const article = "The embedded article body carries the full argument in structured data. ".repeat(30);
    const html = `
      <html><head>
        <meta property="og:title" content="News" />
        <script type="application/ld+json">${JSON.stringify({ "@type": "NewsArticle", articleBody: article })}</script>
      </head><body><article><p>Only a teaser paragraph is visible on the page itself.</p></article></body></html>
    `;
    const metadata = parseMetadataFromHtml(html, "https://example.com/news");
    expect(metadata.bodySource).toBe("jsonld");
    expect(metadata.bodyText).toContain("full argument");
  });
});

describe("fetchMetadata source extractors", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("reads reddit posts via the public JSON API", async () => {
    const selftext = "The core claim: spaced repetition works because retrieval difficulty strengthens the memory trace. ".repeat(3);
    const redditPayload = [
      {
        data: {
          children: [{
            kind: "t3",
            data: {
              title: "What actually makes spaced repetition work?",
              selftext,
              author: "memorynerd",
              subreddit_name_prefixed: "r/Anki",
              permalink: "/r/Anki/comments/abc/what_actually/",
              created_utc: 1719000000,
            },
          }],
        },
      },
      {
        data: {
          children: [{
            kind: "t1",
            data: { body: "Bjork's desirable difficulties research is the canonical source for this — retrieval effort, not exposure, drives retention.", score: 90 },
          }],
        },
      },
    ];

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => redditPayload,
    } as Response));

    const result = await fetchMetadata("https://www.reddit.com/r/Anki/comments/abc/what_actually/");
    expect(result.requiresManualInput).toBe(false);
    expect(result.metadata?.title).toContain("spaced repetition");
    expect(result.metadata?.bodyText).toContain("retrieval difficulty");
    expect(result.metadata?.bodyText).toContain("Bjork");
    expect(result.metadata?.bodySource).toBe("reddit");
    expect(result.metadata?.sourceName).toBe("r/Anki");
  });

  it("picks the English caption track even when another language is listed first", async () => {
    const englishTranscript = "Attention lets a transformer route information between tokens. ".repeat(4);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("youtube.com/oembed")) {
        return { ok: true, json: async () => ({ title: "How transformers work", author_name: "ML Channel" }) } as Response;
      }
      if (url.includes("youtubei/v1/player")) {
        return {
          ok: true,
          json: async () => ({
            playabilityStatus: { status: "OK" },
            videoDetails: { shortDescription: "A video about transformers." },
            captions: {
              playerCaptionsTracklistRenderer: {
                captionTracks: [
                  { baseUrl: "https://yt.test/timedtext?lang=ar", languageCode: "ar", kind: "asr" },
                  { baseUrl: "https://yt.test/timedtext?lang=en", languageCode: "en", kind: "asr" },
                ],
              },
            },
          }),
        } as Response;
      }
      if (url.includes("timedtext?lang=en")) {
        return { ok: true, text: async () => `<transcript><text>${englishTranscript}</text></transcript>` } as unknown as Response;
      }
      return { ok: false, status: 404, json: async () => ({}), text: async () => "" } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchMetadata("https://www.youtube.com/watch?v=abc12345678");
    expect(result.metadata?.bodySource).toBe("transcript");
    expect(result.metadata?.bodyText).toContain("route information between tokens");
    const fetchedUrls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(fetchedUrls.some((u) => u.includes("lang=ar"))).toBe(false);
  });

  it("falls back to the description instead of a wrong-language track when no English captions exist", async () => {
    const description = "Creator description: a walkthrough of the paper's core argument about memory consolidation.";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("youtube.com/oembed")) {
        return { ok: true, json: async () => ({ title: "Foreign-language lecture" }) } as Response;
      }
      if (url.includes("youtubei/v1/player")) {
        return {
          ok: true,
          json: async () => ({
            playabilityStatus: { status: "OK" },
            videoDetails: { shortDescription: description },
            captions: {
              playerCaptionsTracklistRenderer: {
                captionTracks: [{ baseUrl: "https://yt.test/timedtext?lang=ar", languageCode: "ar", kind: "asr" }],
              },
            },
          }),
        } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}), text: async () => "" } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchMetadata("https://www.youtube.com/watch?v=def12345678");
    expect(result.metadata?.bodySource).toBe("description");
    expect(result.metadata?.bodyText).toBe(description);
    const fetchedUrls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(fetchedUrls.some((u) => u.includes("lang=ar"))).toBe(false);
  });

  it("AI-transcribes caption-less videos via Groq instead of falling to the description", async () => {
    vi.stubEnv("GROQ_API_KEY", "test-key");
    const asrText = "This short explains why the blender question measures reasoning, not physics knowledge. ".repeat(2);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("youtube.com/oembed")) {
        return { ok: true, json: async () => ({ title: "Caption-less short" }) } as Response;
      }
      if (url.includes("youtubei/v1/player")) {
        return {
          ok: true,
          json: async () => ({
            playabilityStatus: { status: "OK" },
            videoDetails: { shortDescription: "A short video.", lengthSeconds: "58" },
            streamingData: {
              adaptiveFormats: [
                { url: "https://yt.test/video", mimeType: "video/mp4", bitrate: 800000 },
                { url: "https://yt.test/audio-low", mimeType: "audio/mp4", bitrate: 48000 },
                { url: "https://yt.test/audio-high", mimeType: "audio/webm", bitrate: 128000 },
              ],
            },
          }),
        } as Response;
      }
      if (url === "https://yt.test/audio-low") {
        return {
          ok: true,
          headers: { get: () => null },
          arrayBuffer: async () => new ArrayBuffer(1024),
        } as unknown as Response;
      }
      if (url.includes("api.groq.com")) {
        return { ok: true, text: async () => asrText } as unknown as Response;
      }
      return { ok: false, status: 404, json: async () => ({}), text: async () => "" } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchMetadata("https://www.youtube.com/shorts/ghi12345678");
    expect(result.metadata?.bodySource).toBe("transcript");
    expect(result.metadata?.bodyText).toContain("measures reasoning");
    expect(result.metadata?.usedSupadata).toBeUndefined();
    const fetchedUrls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(fetchedUrls).toContain("https://yt.test/audio-low");
    expect(fetchedUrls.some((u) => u === "https://yt.test/audio-high")).toBe(false);
  });

  it("skips the Groq ASR tier entirely when GROQ_API_KEY is absent", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("youtube.com/oembed")) {
        return { ok: true, json: async () => ({ title: "Caption-less short" }) } as Response;
      }
      if (url.includes("youtubei/v1/player")) {
        return {
          ok: true,
          json: async () => ({
            playabilityStatus: { status: "OK" },
            videoDetails: { shortDescription: "The creator wrote a substantive description here.", lengthSeconds: "58" },
            streamingData: { adaptiveFormats: [{ url: "https://yt.test/audio", mimeType: "audio/mp4", bitrate: 48000 }] },
          }),
        } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}), text: async () => "" } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchMetadata("https://www.youtube.com/shorts/jkl12345678");
    expect(result.metadata?.bodySource).toBe("description");
    const fetchedUrls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(fetchedUrls.some((u) => u.includes("yt.test/audio"))).toBe(false);
    expect(fetchedUrls.some((u) => u.includes("api.groq.com"))).toBe(false);
  });

  it("reads tweet text via the twitter oEmbed endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        html: '<blockquote class="twitter-tweet"><p>Compression is understanding: a model that predicts well has, in some sense, understood.</p>&mdash; Someone (@someone)</blockquote>',
        author_name: "Someone",
      }),
    } as Response));

    const result = await fetchMetadata("https://x.com/someone/status/123456");
    expect(result.requiresManualInput).toBe(false);
    expect(result.metadata?.bodyText).toContain("Compression is understanding");
    expect(result.metadata?.sourceDomain).toBe("x.com");
  });
});
