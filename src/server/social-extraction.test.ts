import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMetadata } from "@/server/metadata";
import { extractInstagramGqlData, parseWebVtt } from "@/server/social";

// The proxy path goes through undici's fetch (per-request dispatcher), not the
// global — route it to a test handler when one is installed.
const proxyState = vi.hoisted(() => ({ handler: undefined as undefined | ((url: string) => Response) }));
vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>();
  return {
    ...actual,
    fetch: async (input: unknown, init?: unknown) =>
      proxyState.handler ? proxyState.handler(String(input)) : actual.fetch(input as never, init as never),
  };
});

type Route = (url: string, init?: RequestInit) => Partial<{ status: number; json: unknown; text: string; bytes: number; headers: Record<string, string> }> | undefined;

function fakeResponse(spec: ReturnType<Route>): Response {
  const status = spec?.status ?? 200;
  const headers = spec?.headers ?? {};
  const text = spec?.text ?? (spec?.json !== undefined ? JSON.stringify(spec.json) : "");
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => (spec?.json !== undefined ? spec.json : JSON.parse(text)),
    text: async () => text,
    arrayBuffer: async () => new ArrayBuffer(spec?.bytes ?? 0),
  } as unknown as Response;
}

/** Installs a URL-keyed fetch stub; unknown URLs 404. Returns the call log. */
function stubFetch(route: Route) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      return fakeResponse(route(url, init) ?? { status: 404, text: "" });
    }),
  );
  return calls;
}

const header = (init: RequestInit | undefined, name: string) =>
  (init?.headers as Record<string, string> | undefined)?.[name] ?? (init?.headers as Record<string, string> | undefined)?.[name.toLowerCase()];

const VTT = `WEBVTT

00:00:00.060 --> 00:00:02.800
You know what the last few days have me thinking pretty clearly?

00:00:02.900 --> 00:00:05.900
Take back your attention. Stop giving it away.

00:00:05.901 --> 00:00:09.341
Take back your attention. Stop giving it away.

00:00:09.342 --> 00:00:13.821
<c>Be intentional</c> with what gets put into your brain &amp; life.
`;

const TIKTOK_ID = "7462834976497601822";

function tiktokPage(item: Record<string, unknown>) {
  const payload = { __DEFAULT_SCOPE__: { "webapp.reflow.video.detail": { itemInfo: { itemStruct: item } } } };
  return `<html><head></head><body><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(payload)}</script></body></html>`;
}

const tiktokItem = (overrides: Record<string, unknown> = {}) => ({
  id: TIKTOK_ID,
  desc: "Take back your attention. #attention #algorithm",
  author: { uniqueId: "hankgreen1", nickname: "Hank Green" },
  video: {
    cover: "https://cover.test/x.jpg",
    subtitleInfos: [
      { LanguageCodeName: "ara-SA", Url: "https://captions.test/ar.vtt", Format: "webvtt", Source: "ASR" },
      { LanguageCodeName: "eng-US", Url: "https://captions.test/en.vtt", Format: "webvtt", Source: "ASR" },
    ],
  },
  stickersOnItem: [{ stickerText: ["POV: you scroll for 3 hours"] }],
  ...overrides,
});

const tiktokPlayer = {
  items: [
    {
      desc: "Take back your attention. #attention #algorithm",
      author_info: { unique_id: "hankgreen1", nickname: "Hank Green" },
      video_info: {
        url_list: ["https://cdn.test/normal.mp4"],
        profiles: [
          { bitrate: 1159596, gear_name: "normal_540_0", play_addr: { data_size: 20800270, url_list: ["https://cdn.test/normal.mp4"] } },
          { bitrate: 453682, gear_name: "lowest_540_0", play_addr: { data_size: 8137936, url_list: ["https://cdn.test/low.mp4"] } },
        ],
      },
    },
  ],
};

const tiktokOembed = {
  title: "Take back your attention. #attention #algorithm",
  author_name: "Hank Green",
  author_unique_id: "hankgreen1",
  thumbnail_url: "https://thumb.test/x.jpg",
  embed_product_id: TIKTOK_ID,
};

const ASR_TEXT = "You know what the last few days have me thinking pretty clearly? Take back your attention. Stop giving it away.";

/** Instagram's embed page inlines gql_data as JSON inside a JSON string inside
 * a script's JSON string literal — three layers, as on the live page. */
function instagramEmbed(media: Record<string, unknown>) {
  const level2 = JSON.stringify({ gql_data: { shortcode_media: media } });
  const level1 = JSON.stringify({ contextJSON: level2, other: "x" });
  const level0 = JSON.stringify(level1);
  return `<html><body><div class="Embed"></div><script>window.__igEmbed(${level0});</script></body></html>`;
}

const igMedia = (overrides: Record<string, unknown> = {}) => ({
  __typename: "GraphVideo",
  shortcode: "DJQJeVQPnI4",
  is_video: true,
  video_url: "https://scontent.test/v/reel.mp4?sig=1",
  display_url: "https://scontent.test/v/cover.jpg",
  video_duration: 70.1,
  owner: { username: "alpha_expeditions" },
  edge_media_to_caption: { edges: [{ node: { text: "¿Lago MÁS HERMOSO del Mundo? 🤔 NatGeo dice que si…\n\n#atitlan #guatemala" } }] },
  ...overrides,
});

const igOembed = { title: "¿Lago MÁS HERMOSO del Mundo? 🤔 NatGeo dice que si…", author_name: "alpha_expeditions", thumbnail_url: "https://thumb.test/ig.jpg" };

beforeEach(() => {
  vi.stubEnv("GROQ_API_KEY", "groq-test");
  vi.stubEnv("OPENAI_API_KEY", "openai-test");
  vi.stubEnv("SUPADATA_API_KEY", "sd-test");
  vi.stubEnv("RESIDENTIAL_PROXY_URL", "");
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  proxyState.handler = undefined;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("parseWebVtt", () => {
  it("keeps cue text only and collapses rolling repeats", () => {
    const text = parseWebVtt(VTT);
    expect(text).toBe(
      "You know what the last few days have me thinking pretty clearly? Take back your attention. Stop giving it away. Be intentional with what gets put into your brain & life.",
    );
  });
});

describe("TikTok extraction", () => {
  it("uses TikTok's own English captions as the transcript — no ASR, no Supadata", async () => {
    const calls = stubFetch((url) => {
      if (url.includes("tiktok.com/oembed")) return { json: tiktokOembed };
      if (url.includes(`/@_/video/${TIKTOK_ID}`)) return { text: tiktokPage(tiktokItem()) };
      if (url.includes("player/api/v1/items")) return { json: tiktokPlayer };
      if (url === "https://captions.test/en.vtt") return { text: VTT };
      return undefined;
    });

    const result = await fetchMetadata(`https://www.tiktok.com/@hankgreen1/video/${TIKTOK_ID}?_r=1&_t=abc`);
    const metadata = result.metadata!;
    expect(result.requiresManualInput).toBe(false);
    expect(metadata.bodySource).toBe("transcript");
    expect(metadata.bodyText).toContain("Take back your attention. Stop giving it away.");
    expect(metadata.bodyText).toContain("Caption: Take back your attention. #attention #algorithm");
    expect(metadata.bodyText).toContain("On-screen text: POV: you scroll for 3 hours");
    expect(metadata.description).toBeUndefined();
    expect(metadata.title).toBe("Take back your attention. #attention #algorithm");
    expect(metadata.authorName).toBe("Hank Green");
    expect(metadata.canonicalUrl).toBe(`https://www.tiktok.com/@hankgreen1/video/${TIKTOK_ID}`);
    expect(metadata.contentType).toBe("video");
    expect(metadata.usedSupadata).toBeUndefined();

    const urls = calls.map((c) => c.url);
    expect(urls.some((u) => u.includes("ar.vtt"))).toBe(false);
    expect(urls.some((u) => u.includes("api.groq.com"))).toBe(false);
    expect(urls.some((u) => u.includes("supadata"))).toBe(false);
  });

  it("resolves share-sheet short links through oEmbed's embed_product_id", async () => {
    const calls = stubFetch((url) => {
      if (url.includes("tiktok.com/oembed")) return { json: tiktokOembed };
      if (url.includes(`/@_/video/${TIKTOK_ID}`)) return { text: tiktokPage(tiktokItem()) };
      if (url.includes("player/api/v1/items")) return { json: tiktokPlayer };
      if (url === "https://captions.test/en.vtt") return { text: VTT };
      return undefined;
    });

    const result = await fetchMetadata("https://vm.tiktok.com/ZMabc123/");
    expect(result.metadata?.bodySource).toBe("transcript");
    expect(result.metadata?.canonicalUrl).toBe(`https://www.tiktok.com/@hankgreen1/video/${TIKTOK_ID}`);
    expect(calls.some((c) => c.url.includes(`item_ids=${TIKTOK_ID}`))).toBe(true);
  });

  it("falls back to redirect-following when oEmbed cannot resolve a short link", async () => {
    stubFetch((url) => {
      if (url.startsWith("https://www.tiktok.com/t/ZTshort")) {
        return { status: 302, headers: { location: `https://www.tiktok.com/@hankgreen1/video/${TIKTOK_ID}?_t=1` } };
      }
      if (url.includes("tiktok.com/oembed")) return { status: 400, text: "" };
      if (url.includes(`/@_/video/${TIKTOK_ID}`)) return { text: tiktokPage(tiktokItem()) };
      if (url.includes("player/api/v1/items")) return { json: tiktokPlayer };
      if (url === "https://captions.test/en.vtt") return { text: VTT };
      return undefined;
    });

    const result = await fetchMetadata("https://www.tiktok.com/t/ZTshort/");
    expect(result.metadata?.bodySource).toBe("transcript");
    expect(result.metadata?.canonicalUrl).toBe(`https://www.tiktok.com/@hankgreen1/video/${TIKTOK_ID}`);
  });

  it("without native captions, downloads the lowest-bitrate rendition in full and transcribes it with Groq", async () => {
    const calls = stubFetch((url) => {
      if (url.includes("tiktok.com/oembed")) return { json: tiktokOembed };
      if (url.includes(`/@_/video/${TIKTOK_ID}`)) return { text: tiktokPage(tiktokItem({ video: { subtitleInfos: [] } })) };
      if (url.includes("player/api/v1/items")) return { json: tiktokPlayer };
      if (url === "https://cdn.test/low.mp4") return { bytes: 5000, headers: { "content-length": "5000" } };
      if (url.includes("api.groq.com")) return { text: ASR_TEXT };
      return undefined;
    });

    const result = await fetchMetadata(`https://www.tiktok.com/@hankgreen1/video/${TIKTOK_ID}`);
    expect(result.metadata?.bodySource).toBe("transcript");
    expect(result.metadata?.bodyText).toContain(ASR_TEXT);
    expect(result.metadata?.usedSupadata).toBeUndefined();

    const media = calls.find((c) => c.url === "https://cdn.test/low.mp4");
    expect(media).toBeDefined();
    // TikTok's CDN honours Range — a leading read would transcribe 10 seconds.
    expect(header(media!.init, "range")).toBeUndefined();
    expect(calls.some((c) => c.url === "https://cdn.test/normal.mp4")).toBe(false);
    expect(calls.some((c) => c.url.includes("supadata"))).toBe(false);
  });

  it("falls back to OpenAI whisper when Groq's request fails", async () => {
    const calls = stubFetch((url) => {
      if (url.includes("tiktok.com/oembed")) return { json: tiktokOembed };
      if (url.includes(`/@_/video/${TIKTOK_ID}`)) return { text: tiktokPage(tiktokItem({ video: { subtitleInfos: [] } })) };
      if (url.includes("player/api/v1/items")) return { json: tiktokPlayer };
      if (url === "https://cdn.test/low.mp4") return { bytes: 5000 };
      if (url.includes("api.groq.com")) return { status: 503, text: "" };
      if (url.includes("api.openai.com")) return { text: ASR_TEXT };
      return undefined;
    });

    const result = await fetchMetadata(`https://www.tiktok.com/@hankgreen1/video/${TIKTOK_ID}`);
    expect(result.metadata?.bodySource).toBe("transcript");
    expect(calls.some((c) => c.url.includes("api.groq.com"))).toBe(true);
    expect(calls.some((c) => c.url.includes("api.openai.com"))).toBe(true);
  });

  it("uses Supadata only as the last backstop, and only when the caller allows it", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    const calls = stubFetch((url) => {
      if (url.includes("tiktok.com/oembed")) return { json: tiktokOembed };
      if (url.includes(`/@_/video/${TIKTOK_ID}`)) return { text: tiktokPage(tiktokItem({ video: { subtitleInfos: [] } })) };
      if (url.includes("player/api/v1/items")) return { json: tiktokPlayer };
      if (url.includes("api.supadata.ai/v1/transcript?")) return { json: { lang: "en", content: ASR_TEXT } };
      return undefined;
    });

    const allowed = await fetchMetadata(`https://www.tiktok.com/@hankgreen1/video/${TIKTOK_ID}`, { allowPaidTranscript: true });
    expect(allowed.metadata?.bodySource).toBe("transcript");
    expect(allowed.metadata?.usedSupadata).toBe(true);
    const supadataCall = calls.find((c) => c.url.includes("api.supadata.ai"));
    expect(supadataCall?.url).toContain(encodeURIComponent(`https://www.tiktok.com/@hankgreen1/video/${TIKTOK_ID}`));
    expect(supadataCall?.url).toContain("mode=auto");
    expect(supadataCall?.url).toContain("lang=en");

    calls.length = 0;
    const denied = await fetchMetadata(`https://www.tiktok.com/@hankgreen1/video/${TIKTOK_ID}`, { allowPaidTranscript: false });
    expect(denied.metadata?.bodySource).toBe("description");
    expect(denied.metadata?.bodyText).toContain("Take back your attention. #attention #algorithm");
    expect(denied.metadata?.description).toBe("Take back your attention. #attention #algorithm");
    expect(denied.metadata?.usedSupadata).toBeUndefined();
    expect(calls.some((c) => c.url.includes("supadata"))).toBe(false);
  });

  it("a speechless clip keeps its caption as the body instead of a two-word ASR result", async () => {
    stubFetch((url) => {
      if (url.includes("tiktok.com/oembed")) return { json: tiktokOembed };
      if (url.includes(`/@_/video/${TIKTOK_ID}`)) return { text: tiktokPage(tiktokItem({ video: { subtitleInfos: [] } })) };
      if (url.includes("player/api/v1/items")) return { json: tiktokPlayer };
      if (url === "https://cdn.test/low.mp4") return { bytes: 5000 };
      if (url.includes("api.groq.com")) return { text: "Thank you." };
      if (url.includes("api.supadata.ai/v1/transcript?")) return { json: { content: "We'll see you next time." } };
      return undefined;
    });

    const result = await fetchMetadata(`https://www.tiktok.com/@hankgreen1/video/${TIKTOK_ID}`);
    expect(result.metadata?.bodySource).toBe("description");
    expect(result.metadata?.bodyText).toContain("Take back your attention.");
    expect(result.metadata?.bodyText).toContain("On-screen text: POV: you scroll for 3 hours");
  });

  it("retries the page and player API through the residential proxy when the direct read is a bot shell", async () => {
    vi.stubEnv("RESIDENTIAL_PROXY_URL", "http://user-{session}:pw@proxy.test:7000");
    const calls = stubFetch((url) => {
      if (url.includes("tiktok.com/oembed")) return { json: tiktokOembed };
      if (url.includes(`/@_/video/${TIKTOK_ID}`)) return { text: "<html><body>Please verify you are human</body></html>" };
      if (url.includes("player/api/v1/items")) return { status: 403, text: "" };
      return undefined;
    });
    // Serve the real pages only through the proxy so the direct→proxy
    // hand-off is observable.
    const proxied: string[] = [];
    proxyState.handler = (url) => {
      proxied.push(url);
      if (url.includes(`/@_/video/${TIKTOK_ID}`)) return fakeResponse({ text: tiktokPage(tiktokItem()) });
      if (url.includes("player/api/v1/items")) return fakeResponse({ json: tiktokPlayer });
      if (url === "https://captions.test/en.vtt") return fakeResponse({ text: VTT });
      return fakeResponse({ status: 404 });
    };

    const result = await fetchMetadata(`https://www.tiktok.com/@hankgreen1/video/${TIKTOK_ID}`);
    expect(result.metadata?.bodySource).toBe("transcript");
    expect(result.metadata?.usedProxy).toBe(true);
    expect(calls.some((c) => c.url.includes(`/@_/video/${TIKTOK_ID}`))).toBe(true); // direct attempt happened
    expect(proxied.some((u) => u.includes(`/@_/video/${TIKTOK_ID}`))).toBe(true);
    expect(proxied.some((u) => u.includes("player/api/v1/items"))).toBe(true);
  });
});

describe("Instagram extraction", () => {
  it("peels the triple-escaped gql_data out of the embed page", () => {
    const html = instagramEmbed(igMedia());
    expect(html).toContain('\\\\\\"gql_data\\\\\\"');
    const gql = extractInstagramGqlData(html) as { shortcode_media: Record<string, unknown> };
    expect(gql.shortcode_media.video_url).toBe("https://scontent.test/v/reel.mp4?sig=1");
    expect(gql.shortcode_media.is_video).toBe(true);
  });

  it("transcribes a reel's video_url and keeps caption + owner", async () => {
    const calls = stubFetch((url) => {
      if (url.includes("i.instagram.com/api/v1/oembed")) return { json: igOembed };
      if (url.includes("/p/DJQJeVQPnI4/embed/captioned/")) return { text: instagramEmbed(igMedia()) };
      if (url.startsWith("https://scontent.test/v/reel.mp4")) return { bytes: 9000, headers: { "content-length": "9000" } };
      if (url.includes("api.groq.com")) return { text: ASR_TEXT };
      return undefined;
    });

    const result = await fetchMetadata("https://www.instagram.com/reel/DJQJeVQPnI4/?igsh=MTIzNA==");
    const metadata = result.metadata!;
    expect(result.requiresManualInput).toBe(false);
    expect(metadata.bodySource).toBe("transcript");
    expect(metadata.bodyText).toContain(ASR_TEXT);
    expect(metadata.bodyText).toContain("Caption: ¿Lago MÁS HERMOSO del Mundo?");
    expect(metadata.title).toBe("¿Lago MÁS HERMOSO del Mundo? 🤔 NatGeo dice que si…");
    expect(metadata.authorName).toBe("alpha_expeditions");
    expect(metadata.canonicalUrl).toBe("https://www.instagram.com/reel/DJQJeVQPnI4");
    expect(metadata.contentType).toBe("video");
    expect(metadata.sourceDomain).toBe("instagram.com");
    expect(metadata.description).toBeUndefined();
    const media = calls.find((c) => c.url.startsWith("https://scontent.test/v/reel.mp4"));
    expect(header(media!.init, "range")).toBeUndefined();
    expect(calls.some((c) => c.url.includes("supadata"))).toBe(false);
  });

  it("uses the caption as the body for photo posts and never calls Supadata for them", async () => {
    const calls = stubFetch((url) => {
      if (url.includes("i.instagram.com/api/v1/oembed")) return { json: { ...igOembed, title: "Nasa has released the first photographs", author_name: "bbcafrica" } };
      if (url.includes("/p/DW1xjVPCXJ0/embed/captioned/")) {
        return {
          text: instagramEmbed(
            igMedia({
              __typename: "GraphSidecar",
              shortcode: "DW1xjVPCXJ0",
              is_video: false,
              video_url: undefined,
              owner: { username: "bbcafrica" },
              edge_media_to_caption: { edges: [{ node: { text: "🚀 Nasa has released the first photographs taken by the Artemis II astronauts during their fly-by of the Moon." } }] },
            }),
          ),
        };
      }
      return undefined;
    });

    const result = await fetchMetadata("https://www.instagram.com/p/DW1xjVPCXJ0/");
    const metadata = result.metadata!;
    expect(metadata.bodySource).toBe("description");
    expect(metadata.bodyText).toContain("Artemis II astronauts");
    expect(metadata.contentType).toBe("image");
    expect(metadata.canonicalUrl).toBe("https://www.instagram.com/p/DW1xjVPCXJ0");
    expect(metadata.authorName).toBe("bbcafrica");
    expect(calls.some((c) => c.url.includes("supadata"))).toBe(false);
    expect(calls.some((c) => c.url.includes("api.groq.com"))).toBe(false);
  });

  it("resolves instagram.com/share/… links by following the redirect", async () => {
    stubFetch((url) => {
      if (url === "https://www.instagram.com/share/reel/_abc123") {
        return { status: 302, headers: { location: "https://www.instagram.com/reel/DJQJeVQPnI4/?igsh=zzz" } };
      }
      if (url.includes("i.instagram.com/api/v1/oembed")) return { json: igOembed };
      if (url.includes("/p/DJQJeVQPnI4/embed/captioned/")) return { text: instagramEmbed(igMedia()) };
      if (url.startsWith("https://scontent.test/v/reel.mp4")) return { bytes: 9000 };
      if (url.includes("api.groq.com")) return { text: ASR_TEXT };
      return undefined;
    });

    const result = await fetchMetadata("https://www.instagram.com/share/reel/_abc123");
    expect(result.metadata?.canonicalUrl).toBe("https://www.instagram.com/reel/DJQJeVQPnI4");
    expect(result.metadata?.bodySource).toBe("transcript");
  });

  it("falls back to Supadata for a reel whose media could not be transcribed", async () => {
    const calls = stubFetch((url) => {
      if (url.includes("i.instagram.com/api/v1/oembed")) return { json: igOembed };
      if (url.includes("/p/DJQJeVQPnI4/embed/captioned/")) return { text: instagramEmbed(igMedia()) };
      if (url.startsWith("https://scontent.test/v/reel.mp4")) return { status: 403, text: "" };
      if (url.includes("api.supadata.ai/v1/transcript?")) return { json: { content: ASR_TEXT } };
      return undefined;
    });

    const result = await fetchMetadata("https://www.instagram.com/reel/DJQJeVQPnI4/");
    expect(result.metadata?.bodySource).toBe("transcript");
    expect(result.metadata?.usedSupadata).toBe(true);
    const supadataCall = calls.find((c) => c.url.includes("api.supadata.ai"));
    expect(supadataCall?.url).toContain(encodeURIComponent("https://www.instagram.com/reel/DJQJeVQPnI4/"));
  });
});

const VISION_TEXT = "Frame 1: 5 habits that quietly ruin your focus. Frame 2: 1. Checking your phone before getting out of bed. Frame 3: 2. Keeping every tab open.";
const visionRoute = (url: string) => (url.includes("api.openai.com/v1/chat/completions") ? { json: { choices: [{ message: { content: VISION_TEXT } }] } } : undefined);

describe("speechless posts — vision over frames and slides", () => {
  it("a TikTok with no speech is read off its cover frames (and Supadata is not called)", async () => {
    const calls = stubFetch((url) => {
      if (url.includes("tiktok.com/oembed")) return { json: tiktokOembed };
      if (url.includes(`/@_/video/${TIKTOK_ID}`)) {
        return { text: tiktokPage(tiktokItem({ video: { subtitleInfos: [], cover: "https://cover.test/cover.jpg", originCover: "https://cover.test/origin.jpg" } })) };
      }
      if (url.includes("player/api/v1/items")) return { json: tiktokPlayer };
      if (url === "https://cdn.test/low.mp4") return { bytes: 5000 };
      if (url.includes("api.groq.com")) return { text: "Thank you." };
      if (url.startsWith("https://cover.test/")) return { bytes: 2000, headers: { "content-type": "image/jpeg", "content-length": "2000" } };
      return visionRoute(url);
    });

    const result = await fetchMetadata(`https://www.tiktok.com/@hankgreen1/video/${TIKTOK_ID}`);
    const metadata = result.metadata!;
    expect(metadata.bodySource).toBe("vision");
    expect(metadata.bodyText).toContain("5 habits that quietly ruin your focus");
    expect(metadata.bodyText).toContain("Caption: Take back your attention.");
    expect(metadata.bodyText).toContain("On-screen text: POV: you scroll for 3 hours");
    expect(metadata.description).toBeUndefined();
    expect(calls.filter((c) => c.url.startsWith("https://cover.test/"))).toHaveLength(2);
    expect(calls.some((c) => c.url.includes("supadata"))).toBe(false);
    const vision = calls.find((c) => c.url.includes("chat/completions"));
    const body = JSON.parse(String(vision!.init!.body));
    expect(body.messages[0].content.filter((p: { type: string }) => p.type === "image_url")).toHaveLength(2);
  });

  it("a TikTok photo slideshow is read slide by slide, in order, without ASR", async () => {
    const images = Array.from({ length: 8 }, (_, i) => `https://img.test/slide-${i + 1}.jpg`);
    const calls = stubFetch((url) => {
      if (url.includes("tiktok.com/oembed")) return { json: { ...tiktokOembed, title: "5 habits that quietly ruin your focus" } };
      if (url.includes(`/@_/video/${TIKTOK_ID}`)) {
        return {
          text: tiktokPage(
            tiktokItem({
              desc: "5 habits that quietly ruin your focus #productivity",
              video: {},
              imagePost: { title: "5 habits", images: images.map((u) => ({ imageURL: { urlList: [u, `${u}?alt`] } })) },
            }),
          ),
        };
      }
      if (url.includes("player/api/v1/items")) return { json: { items: [] } };
      if (url.startsWith("https://img.test/")) return { bytes: 1500, headers: { "content-type": "image/jpeg" } };
      return visionRoute(url);
    });

    const result = await fetchMetadata(`https://www.tiktok.com/@hankgreen1/photo/${TIKTOK_ID}`);
    const metadata = result.metadata!;
    expect(metadata.bodySource).toBe("vision");
    expect(metadata.bodyText).toContain("Frame 2: 1. Checking your phone");
    expect(metadata.bodyText).toContain("[… 2 more slides not shown]");
    expect(metadata.contentType).toBe("image");
    expect(metadata.canonicalUrl).toBe(`https://www.tiktok.com/@hankgreen1/photo/${TIKTOK_ID}`);
    expect(metadata.title).toBe("5 habits that quietly ruin your focus #productivity");
    // First six slides, in order; no media download, no ASR, no Supadata.
    const fetchedSlides = calls.filter((c) => c.url.startsWith("https://img.test/")).map((c) => c.url);
    expect(fetchedSlides).toEqual(images.slice(0, 6));
    expect(calls.some((c) => c.url.includes("api.groq.com") || c.url.includes("supadata") || c.url.endsWith(".mp4"))).toBe(false);
  });

  it("an Instagram carousel is read slide by slide and keeps Instagram's own alt text", async () => {
    const slides = ["https://scontent.test/s1.jpg", "https://scontent.test/s2.jpg", "https://scontent.test/s3.jpg"];
    const calls = stubFetch((url) => {
      if (url.includes("i.instagram.com/api/v1/oembed")) return { json: { ...igOembed, title: "Swipe →", author_name: "focuslab" } };
      if (url.includes("/p/DCAROUSEL1/embed/captioned/")) {
        return {
          text: instagramEmbed(
            igMedia({
              __typename: "GraphSidecar",
              shortcode: "DCAROUSEL1",
              is_video: false,
              video_url: undefined,
              owner: { username: "focuslab" },
              accessibility_caption: "Photo by focuslab on August 20, 2026. May be an image of text that says '5 habits that ruin focus'.",
              edge_media_to_caption: { edges: [{ node: { text: "Swipe → the habits that quietly ruin your focus" } }] },
              edge_sidecar_to_children: {
                edges: slides.map((display_url, i) => ({ node: { __typename: "GraphImage", is_video: false, display_url, accessibility_caption: i === 1 ? "May be an image of text that says 'Checking your phone before getting out of bed'." : "May be an image of nature." } })),
              },
            }),
          ),
        };
      }
      if (url.startsWith("https://scontent.test/s")) return { bytes: 1500, headers: { "content-type": "image/jpeg" } };
      return visionRoute(url);
    });

    const result = await fetchMetadata("https://www.instagram.com/p/DCAROUSEL1/");
    const metadata = result.metadata!;
    expect(metadata.bodySource).toBe("vision");
    expect(metadata.bodyText).toContain("Frame 3: 2. Keeping every tab open.");
    expect(metadata.bodyText).toContain("Caption: Swipe → the habits");
    expect(metadata.bodyText).toContain("Alt text:");
    expect(metadata.bodyText).toContain("Checking your phone before getting out of bed");
    expect(metadata.bodyText).not.toContain("May be an image of nature");
    expect(metadata.contentType).toBe("image");
    expect(calls.filter((c) => c.url.startsWith("https://scontent.test/s")).map((c) => c.url)).toEqual(slides);
    expect(calls.some((c) => c.url.includes("supadata") || c.url.includes("api.groq.com"))).toBe(false);
  });

  it("an Instagram reel with no speech falls back to its cover frame instead of paying Supadata", async () => {
    const calls = stubFetch((url) => {
      if (url.includes("i.instagram.com/api/v1/oembed")) return { json: igOembed };
      if (url.includes("/p/DJQJeVQPnI4/embed/captioned/")) return { text: instagramEmbed(igMedia()) };
      if (url.startsWith("https://scontent.test/v/reel.mp4")) return { bytes: 9000 };
      if (url.includes("api.groq.com")) return { text: "Thank you." };
      if (url === "https://scontent.test/v/cover.jpg") return { bytes: 1500, headers: { "content-type": "image/jpeg" } };
      return visionRoute(url);
    });

    const result = await fetchMetadata("https://www.instagram.com/reel/DJQJeVQPnI4/");
    expect(result.metadata?.bodySource).toBe("vision");
    expect(result.metadata?.contentType).toBe("video");
    expect(calls.some((c) => c.url.includes("supadata"))).toBe(false);
  });

  it("without a vision key, a speechless post still keeps its caption as the body", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    stubFetch((url) => {
      if (url.includes("i.instagram.com/api/v1/oembed")) return { json: igOembed };
      if (url.includes("/p/DJQJeVQPnI4/embed/captioned/")) return { text: instagramEmbed(igMedia({ is_video: false, video_url: undefined })) };
      return undefined;
    });
    const result = await fetchMetadata("https://www.instagram.com/p/DJQJeVQPnI4/");
    expect(result.metadata?.bodySource).toBe("description");
    expect(result.metadata?.bodyText).toContain("¿Lago MÁS HERMOSO");
  });
});

describe("URL shapes real share sheets produce", () => {
  const tiktokRoutes = (url: string) => {
    if (url.includes("tiktok.com/oembed")) return { json: tiktokOembed };
    if (url.includes(`/@_/video/${TIKTOK_ID}`)) return { text: tiktokPage(tiktokItem()) };
    if (url.includes("player/api/v1/items")) return { json: tiktokPlayer };
    if (url === "https://captions.test/en.vtt") return { text: VTT };
    return undefined;
  };
  const igRoutes = (url: string) => {
    if (url.includes("i.instagram.com/api/v1/oembed")) return { json: igOembed };
    if (url.includes("/p/DJQJeVQPnI4/embed/captioned/")) return { text: instagramEmbed(igMedia()) };
    if (url.startsWith("https://scontent.test/v/reel.mp4")) return { bytes: 9000 };
    if (url.includes("api.groq.com")) return { text: ASR_TEXT };
    return undefined;
  };

  it.each([
    `https://www.tiktok.com/@hankgreen1/video/${TIKTOK_ID}?is_from_webapp=1&sender_device=pc`,
    `https://m.tiktok.com/v/${TIKTOK_ID}.html`,
    `https://www.tiktok.com/embed/v2/${TIKTOK_ID}`,
    `https://www.tiktok.com/@_/video/${TIKTOK_ID}`,
    "https://vt.tiktok.com/ZSabc123/",
    "https://vm.tiktok.com/ZMabc123",
  ])("TikTok: %s", async (url) => {
    stubFetch(tiktokRoutes);
    const result = await fetchMetadata(url);
    expect(result.metadata?.bodySource).toBe("transcript");
    expect(result.metadata?.canonicalUrl).toBe(`https://www.tiktok.com/@hankgreen1/video/${TIKTOK_ID}`);
  });

  it.each([
    "https://www.instagram.com/reel/DJQJeVQPnI4/?igsh=MTIzNA==",
    "https://www.instagram.com/reels/DJQJeVQPnI4/",
    "https://www.instagram.com/alpha_expeditions/reel/DJQJeVQPnI4/",
    "https://www.instagram.com/alpha_expeditions/p/DJQJeVQPnI4/?img_index=1",
    "https://instagram.com/p/DJQJeVQPnI4",
    "https://instagr.am/p/DJQJeVQPnI4/",
    "https://www.instagram.com/tv/DJQJeVQPnI4/",
  ])("Instagram: %s", async (url) => {
    stubFetch(igRoutes);
    const result = await fetchMetadata(url);
    expect(result.metadata?.bodySource).toBe("transcript");
    expect(result.metadata?.canonicalUrl).toBe("https://www.instagram.com/reel/DJQJeVQPnI4");
  });

  it("unwraps l.instagram.com outbound redirect links to the real destination", async () => {
    stubFetch((url) => {
      if (url.startsWith("https://example.com/essay")) {
        return { text: `<html><head><title>Essay</title><meta property="og:title" content="Essay" /></head><body><article><p>${"A substantive paragraph about attention. ".repeat(40)}</p></article></body></html>` };
      }
      return undefined;
    });
    const result = await fetchMetadata("https://l.instagram.com/?u=https%3A%2F%2Fexample.com%2Fessay&e=AT0abc");
    expect(result.metadata?.title).toBe("Essay");
    expect(result.metadata?.bodyText).toContain("substantive paragraph");
  });

  it("a deleted or private TikTok becomes a clean ask-the-user stub, not the app shell", async () => {
    stubFetch((url) => {
      if (url.includes("tiktok.com/oembed")) return { status: 400, text: "" };
      if (url.includes("/@_/video/")) return { text: "<html><head><title>TikTok - Make Your Day</title></head><body></body></html>" };
      if (url.includes("player/api/v1/items")) return { json: { results: [{ code: "nil_core_data" }] } };
      return undefined;
    });
    const result = await fetchMetadata("https://www.tiktok.com/@someone/video/7000000000000000001");
    expect(result.requiresManualInput).toBe(true);
    expect(result.metadata).toBeUndefined();
  });

  it("an Instagram profile or story URL falls through to the generic scrape", async () => {
    stubFetch((url) => {
      if (url.startsWith("https://www.instagram.com/natgeo")) {
        return { text: `<html><head><meta property="og:title" content="National Geographic (@natgeo)" /><meta property="og:description" content="Photos" /></head></html>` };
      }
      return undefined;
    });
    const result = await fetchMetadata("https://www.instagram.com/natgeo/");
    expect(result.metadata?.title).toContain("National Geographic");
  });
});
