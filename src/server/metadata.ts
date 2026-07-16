import { Readability } from "@mozilla/readability";
import { load } from "cheerio";
import { parseHTML } from "linkedom";
import slugify from "slugify";
import { extractText, getDocumentProxy, getMeta } from "unpdf";
import { createProxySession, type ProxySession } from "@/server/proxyFetch";
import { groqConfigured, transcribeAudioUrl } from "@/server/transcribe";
import { normalizeUrl } from "@/server/url";

export type BodySource = "transcript" | "body" | "jsonld" | "reddit" | "description" | "pdf";

export type ExtractedMetadata = {
  title?: string;
  description?: string;
  canonicalUrl?: string;
  originalUrl: string;
  siteName?: string;
  imageUrl?: string;
  authorName?: string;
  publishedAt?: Date;
  sourceName?: string;
  sourceDomain?: string;
  contentType?: string;
  /** Main body text extracted from the page, for semantic embedding + cleanup. */
  bodyText?: string;
  /** Where bodyText came from — lets the insight layer know whether it is
   * reading the actual content (transcript/body) or only a summary. */
  bodySource?: BodySource;
  /** True when the residential proxy produced the body (cost/success telemetry). */
  usedProxy?: boolean;
  /** True when a paid Supadata call produced the body (credit-burn telemetry). */
  usedSupadata?: boolean;
};

export type ContentConfidence = "rich" | "partial" | "thin";

/**
 * How much substantive content a capture actually carries. Everything
 * downstream (embedding, topics, insights) degrades with this, so "thin"
 * is the signal to ask the user what the content was about instead of
 * letting the LLM construct an argument from a title.
 */
export function scoreContentConfidence(args: {
  bodyText?: string | null;
  description?: string | null;
}): ContentConfidence {
  const body = (args.bodyText ?? "").trim();
  if (body.length >= 800) return "rich";
  const desc = (args.description ?? "").trim();
  if (body.length >= 150 || desc.length >= 150) return "partial";
  return "thin";
}

/** Article/transcript body budget. Long content is fitted via
 * condenseToBudget rather than truncated at this many chars. */
const BODY_TEXT_LIMIT = 12000;

/**
 * Fits long text into the body budget by sampling head, middle, and tail
 * instead of blind truncation. A 2-hour transcript cut at the old cap kept
 * only the first ~8 minutes, so embeddings, topics, and insights never saw
 * the argument's development or conclusion. Segment edges land on word
 * boundaries, and elisions are marked so the LLM knows material was skipped.
 */
function condenseToBudget(text: string, limit = BODY_TEXT_LIMIT): string {
  if (text.length <= limit) return text;
  const sep = "\n[…]\n";
  const budget = limit - 2 * sep.length;
  const headLen = Math.floor(budget * 0.45);
  const midLen = Math.floor(budget * 0.3);
  const tailLen = budget - headLen - midLen;
  const head = text.slice(0, headLen).replace(/\S+$/, "").trimEnd();
  const midStart = Math.floor(text.length / 2 - midLen / 2);
  const middle = text
    .slice(midStart, midStart + midLen)
    .replace(/^\S+/, "")
    .replace(/\S+$/, "")
    .trim();
  const tail = text
    .slice(text.length - tailLen)
    .replace(/^\S+/, "")
    .trimStart();
  return [head, middle, tail].join(sep);
}

/** Share of alphabetic characters that are Latin — the wrong-language guard.
 * Digits/punctuation are ignored so code-heavy or numeric text isn't punished. */
function latinShare(text: string): number {
  let latin = 0;
  let other = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) latin++;
    else if (c > 0x2ff) other++;
  }
  return latin + other === 0 ? 0 : latin / (latin + other);
}

/** fetch with a hard timeout so a hung host can't stall the capture pipeline. */
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reads JSON-LD blocks for substantive content the visible DOM may not carry:
 * `articleBody` (many news sites embed the full article) and long-form
 * `description` (podcast episode pages — Apple Podcasts and most podcast hosts
 * publish real show notes here even when og:description is a stub).
 */
function extractJsonLd($: ReturnType<typeof load>): { articleBody?: string; description?: string } {
  let articleBody: string | undefined;
  let description: string | undefined;

  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    if (typeof obj.articleBody === "string" && obj.articleBody.trim().length >= 200) {
      const text = obj.articleBody.replace(/\s+/g, " ").trim();
      if (!articleBody || text.length > articleBody.length) articleBody = text;
    }
    if (typeof obj.description === "string" && obj.description.trim().length >= 120) {
      const text = obj.description.replace(/\s+/g, " ").trim();
      if (!description || text.length > description.length) description = text;
    }
    if (obj["@graph"]) visit(obj["@graph"]);
  };

  $("script[type='application/ld+json']").each((_, el) => {
    const raw = $(el).text();
    if (!raw?.trim()) return;
    try {
      visit(JSON.parse(raw));
    } catch {
      // malformed JSON-LD is common; skip the block
    }
  });

  // Full articleBody — the caller condenses the winning extraction to budget.
  return {
    articleBody,
    description: description?.slice(0, 6000),
  };
}

/** Pulls readable body text out of an article page (heuristic fallback). */
function extractBodyText($: ReturnType<typeof load>): string | undefined {
  $("script, style, noscript, nav, header, footer, aside, form").remove();
  const root = $("article").first();
  const scope = root.length ? root : $("main").first().length ? $("main").first() : $("body");
  const paragraphs: string[] = [];
  scope.find("p, li, blockquote, h2, h3").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (text.length >= 40) paragraphs.push(text);
  });
  const joined = paragraphs.join("\n").trim();
  return joined.length >= 40 ? joined : undefined;
}

/**
 * Mozilla Readability over a linkedom DOM — the accuracy path for articles,
 * blogs, and Substack posts. The cheerio heuristic above keeps whole nav/footer
 * text when a page lacks <article>/<main>; Readability scores content blocks
 * instead. Best-effort: returns undefined when Readability rejects the page.
 */
function extractReadabilityText(html: string): string | undefined {
  try {
    const { document } = parseHTML(html);
    const article = new Readability(document as unknown as Document, { charThreshold: 250 }).parse();
    const text = (article?.textContent ?? "")
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join("\n")
      .trim();
    return text.length >= 200 ? text : undefined;
  } catch {
    return undefined;
  }
}

function absoluteUrl(href: string | undefined, baseUrl: string) {
  if (!href) {
    return undefined;
  }

  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return undefined;
  }
}

function pickContentType(url: URL, ogType?: string, title?: string) {
  const target = `${ogType ?? ""} ${title ?? ""}`.toLowerCase();

  if (url.hostname.includes("youtube.com") || url.hostname === "youtu.be") {
    return "video";
  }

  if (target.includes("podcast") || target.includes("episode") || target.includes("audio")) {
    return "podcast";
  }

  if ((ogType ?? "").toLowerCase().includes("article")) {
    return "article";
  }

  return "link";
}

function clean(value: string | undefined | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function parseMetadataFromHtml(html: string, originalUrl: string): ExtractedMetadata {
  const $ = load(html);
  const canonicalUrl = absoluteUrl(
    clean($("meta[property='og:url']").attr("content")) ?? clean($("link[rel='canonical']").attr("href")),
    originalUrl,
  );
  const title =
    clean($("meta[property='og:title']").attr("content")) ??
    clean($("meta[name='twitter:title']").attr("content")) ??
    clean($("title").text());
  const description =
    clean($("meta[property='og:description']").attr("content")) ??
    clean($("meta[name='description']").attr("content")) ??
    clean($("meta[name='twitter:description']").attr("content"));
  const imageUrl = absoluteUrl(
    clean($("meta[property='og:image']").attr("content")) ?? clean($("meta[name='twitter:image']").attr("content")),
    originalUrl,
  );
  const siteName =
    clean($("meta[property='og:site_name']").attr("content")) ??
    clean($("meta[name='application-name']").attr("content"));
  const authorName =
    clean($("meta[name='author']").attr("content")) ??
    clean($("meta[property='article:author']").attr("content"));
  const publishedAtValue =
    clean($("meta[property='article:published_time']").attr("content")) ??
    clean($("time").attr("datetime"));
  const publishedAt = publishedAtValue ? new Date(publishedAtValue) : undefined;
  const parsedUrl = new URL(canonicalUrl ?? originalUrl);
  const sourceDomain = parsedUrl.hostname.replace(/^www\./, "");
  const sourceName = siteName ?? sourceDomain;
  const ogType = clean($("meta[property='og:type']").attr("content"));
  const contentType = pickContentType(parsedUrl, ogType, title);
  // JSON-LD must be read before extractBodyText, which strips <script> tags.
  const jsonLd = extractJsonLd($);
  const readabilityBody = extractReadabilityText(html);
  const heuristicBody = extractBodyText($);
  // Longest substantive extraction wins: Readability on real articles, the
  // heuristic on pages Readability rejects, JSON-LD articleBody when the DOM
  // is thinner than the embedded article; fall back to a long-form JSON-LD
  // description (podcast show notes) when the page has no readable body.
  const domBody =
    (readabilityBody?.length ?? 0) > (heuristicBody?.length ?? 0) ? readabilityBody : heuristicBody;
  let bodyText = domBody;
  let bodySource: BodySource | undefined = domBody ? "body" : undefined;
  if (jsonLd.articleBody && jsonLd.articleBody.length > (bodyText?.length ?? 0)) {
    bodyText = jsonLd.articleBody;
    bodySource = "jsonld";
  }
  if (!bodyText && jsonLd.description) {
    bodyText = jsonLd.description;
    bodySource = "jsonld";
  }
  if (bodyText) bodyText = condenseToBudget(bodyText);

  return {
    title,
    description: description ?? jsonLd.description,
    bodyText,
    bodySource,
    canonicalUrl: canonicalUrl ? normalizeUrl(canonicalUrl) : normalizeUrl(originalUrl),
    originalUrl,
    siteName,
    imageUrl,
    authorName,
    publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : undefined,
    sourceName,
    sourceDomain,
    contentType,
  };
}

// A real browser UA + consent cookie for sites that serve stripped pages to
// non-browser agents (Reddit's JSON API, bot-guarded article sites).
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const YT_HEADERS = {
  "user-agent": BROWSER_UA,
  "accept-language": "en-US,en;q=0.9",
  cookie: "CONSENT=YES+cb.20210328-17-p0.en+FX+000",
} as const;

type CaptionTrack = { baseUrl?: string; languageCode?: string; kind?: string };
type AudioFormat = { url?: string; mimeType?: string; bitrate?: number; contentLength?: string };

type YouTubePlayerData = {
  tracks: CaptionTrack[];
  description?: string;
  playability?: string;
  /** Video length — bounds what the ASR tier is willing to transcribe. */
  lengthSeconds?: number;
  /** Direct audio-only stream URLs, lowest bitrate first (ASR needs no fidelity). */
  audioFormats: AudioFormat[];
};

// YouTube gates caption downloads from its web surface behind a
// proof-of-origin token — the timedtext URLs embedded in the watch page now
// return an empty 200 even from residential IPs. The InnerTube player API
// still serves working caption tracks to mobile clients (the same route
// youtube-transcript-api and yt-dlp use), and its response also carries the
// creator description, so one small POST replaces the old 1MB+ watch-page
// scrape entirely.
//
// Two clients, tried in order: IOS benchmarked marginally faster with slightly
// fuller tracks (2026-07); ANDROID is the long-serving fallback. Retrying on a
// *different* client hedges against YouTube blocking one client family, which
// is how the old watch-page scrape died.
type InnertubeClient = { ua: string; context: Record<string, unknown> };
const INNERTUBE_CLIENTS: InnertubeClient[] = [
  {
    ua: "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
    context: { client: { clientName: "IOS", clientVersion: "20.10.4", deviceModel: "iPhone16,2", hl: "en" } },
  },
  {
    ua: "com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip",
    context: { client: { clientName: "ANDROID", clientVersion: "20.10.38", androidSdkVersion: 30, hl: "en" } },
  },
];

/** Extracts the video id from watch/youtu.be/shorts/embed/live URL forms. */
function youTubeVideoId(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (hostOf(parsed) === "youtu.be") return parsed.pathname.split("/").filter(Boolean)[0];
    const v = parsed.searchParams.get("v");
    if (v) return v;
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length >= 2 && ["shorts", "embed", "live"].includes(segments[0])) return segments[1];
    return undefined;
  } catch {
    return undefined;
  }
}

/** Calls the InnerTube player API for a video's caption tracks + description. */
async function fetchYouTubePlayerData(
  videoId: string,
  session: ProxySession,
  client: InnertubeClient,
): Promise<YouTubePlayerData | undefined> {
  // Tighter than the 12s session default: a healthy InnerTube round-trip is
  // well under 2s even through the proxy, and on timeout the Supadata native
  // fallback still runs — the user is waiting on the capture sheet.
  const res = await session.fetch(
    "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
    {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": client.ua },
      body: JSON.stringify({ context: client.context, videoId }),
    },
    6000,
  );
  if (!res.ok) return undefined;
  const data = (await res.json()) as {
    captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } };
    videoDetails?: { shortDescription?: string; lengthSeconds?: string };
    playabilityStatus?: { status?: string };
    streamingData?: { adaptiveFormats?: AudioFormat[] };
  };
  const lengthSeconds = Number(data.videoDetails?.lengthSeconds);
  return {
    tracks: data.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [],
    description: data.videoDetails?.shortDescription,
    playability: data.playabilityStatus?.status,
    lengthSeconds: Number.isFinite(lengthSeconds) && lengthSeconds > 0 ? lengthSeconds : undefined,
    audioFormats: (data.streamingData?.adaptiveFormats ?? [])
      .filter((f) => f.url && f.mimeType?.startsWith("audio/"))
      .sort((a, b) => (a.bitrate ?? Infinity) - (b.bitrate ?? Infinity)),
  };
}

/** Fetches and flattens a caption track (timedtext XML) into transcript text. */
async function fetchCaptionText(
  baseUrl: string,
  session: ProxySession,
  client: InnertubeClient,
): Promise<string | undefined> {
  const res = await session.fetch(baseUrl, { headers: { "user-agent": client.ua } }, 6000);
  if (!res.ok) return undefined;
  const $ = load(await res.text(), { xmlMode: true });
  const text = $("p, text")
    .map((_, el) => $(el).text())
    .get()
    .join(" ")
    // Caption XML double-encodes entities ("I&amp;#39;m"); one decode pass
    // remains after parsing, so transcripts read "I&#39;m" without this.
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  // Full transcript — the caller condenses to budget so long videos keep
  // their middle and conclusion instead of just the first minutes.
  return text.length >= 40 ? text : undefined;
}

/**
 * AI-transcribes a video's lowest-bitrate audio stream via Groq when captions
 * are missing/unusable — the path Supadata billed 2 credits/min for. Must run
 * inside the same proxy session that fetched the player data: streaming URLs
 * are IP-bound. English-only, matching caption selection: a wrong-language
 * transcript poisons embeddings worse than the description fallback. Cost and
 * latency are bounded by the download cap in transcribe.ts — for videos longer
 * than the cap the transcript covers the opening and is marked as elided.
 */
async function attemptYouTubeAsr(
  videoId: string,
  player: YouTubePlayerData,
  session: ProxySession,
  client: InnertubeClient,
): Promise<string | undefined> {
  if (!groqConfigured()) return undefined;
  const format = player.audioFormats[0];
  if (!format?.url) return undefined;
  const filename = format.mimeType?.includes("webm") ? "audio.webm" : "audio.m4a";
  const result = await transcribeAudioUrl({
    url: format.url,
    session,
    headers: { "user-agent": client.ua },
    filename,
    // The capped read is ~256KB; a healthy exit serves it in ~2s. A stalled
    // proxy exit should fail fast so the fresh-exit retry can run instead.
    downloadTimeoutMs: 10000,
  });
  if (!result || latinShare(result.text) < 0.7) return undefined;
  console.log(
    JSON.stringify({ event: "yt_asr", videoId, seconds: player.lengthSeconds ?? null, partial: result.partial }),
  );
  return result.partial ? `${result.text}\n[…]` : result.text;
}

/**
 * Extracts substantive body text for a YouTube video. A video has no article
 * body, so the transcript is the real content the insight and embedding work
 * from; the creator-written description is only a fallback since it's often
 * empty or link spam. Best-effort: returns undefined on any failure.
 *
 * Runs through one sticky residential-proxy session when configured: YouTube
 * bot-walls datacenter IPs, and both requests should come from one exit IP.
 */
async function attemptYouTubeBodyText(
  videoId: string,
  client: InnertubeClient,
): Promise<{
  text?: string;
  source?: BodySource;
  viaProxy: boolean;
  /** Why the transcript path came up empty — drives the retry decision and
   * the diagnostic log so prod tells us when Supadata is burning credits. */
  failure?: "player_unavailable" | "no_tracks" | "no_english_tracks" | "captions_empty" | string;
  /** True when the ASR tier had an audio stream to work with but still missed
   * — flake-shaped, so the caller should retry on a fresh session. */
  asrFlake?: boolean;
  description?: string;
}> {
  const session = createProxySession();
  try {
    const player = await fetchYouTubePlayerData(videoId, session, client);
    if (!player) return { viaProxy: session.viaProxy, failure: "player_unavailable" };
    // A non-OK playability (LOGIN_REQUIRED = "confirm you're not a bot") means
    // this exit IP is flagged; the response carries no caption tracks.
    if (player.playability && player.playability !== "OK") {
      return { viaProxy: session.viaProxy, failure: `playability_${player.playability}` };
    }

    // English tracks only: human-authored first, then auto-generated. Never
    // grab an arbitrary track — a "whatever exists" fallback once fed the
    // embedding pipeline an Arabic transcript of an English video, and a
    // wrong-language transcript is worse than the description fallback.
    // Try up to two distinct tracks — a single track occasionally serves an
    // empty 200 while its sibling works.
    let failure: string;
    if (player.tracks.length > 0) {
      const ranked = [
        player.tracks.find((t) => t.languageCode?.startsWith("en") && t.kind !== "asr"),
        player.tracks.find((t) => t.languageCode?.startsWith("en")),
      ].filter((t): t is CaptionTrack => Boolean(t?.baseUrl));
      if (ranked.length > 0) {
        const distinct = ranked.filter((t, i) => ranked.findIndex((o) => o.baseUrl === t.baseUrl) === i).slice(0, 2);
        for (const track of distinct) {
          const transcript = await fetchCaptionText(track.baseUrl!, session, client);
          if (transcript) return { text: transcript, source: "transcript", viaProxy: session.viaProxy };
        }
        failure = "captions_empty";
      } else {
        failure = "no_english_tracks";
      }
    } else {
      failure = "no_tracks";
    }

    // Captions missed — AI-transcribe the audio before giving up. Runs inside
    // this session because YouTube streaming URLs are bound to its exit IP.
    const asr = await attemptYouTubeAsr(videoId, player, session, client);
    if (asr) return { text: asr, source: "transcript", viaProxy: session.viaProxy };

    // An ASR miss despite an available audio stream is usually a stalled or
    // flagged exit, not a fact about the video — let the caller retry fresh.
    const asrFlake = groqConfigured() && Boolean(player.audioFormats[0]?.url);
    return { viaProxy: session.viaProxy, failure, asrFlake, description: player.description };
  } catch {
    return { viaProxy: session.viaProxy, failure: "player_unavailable" };
  } finally {
    await session.close().catch(() => {});
  }
}

/** How long the first InnerTube client gets before the second one is started
 * in parallel. A healthy round-trip answers well under this, so the hedge only
 * fires on stalls — where the old serial retry stacked the full timeout chain
 * of attempt one (up to ~20s) before attempt two even began. */
const INNERTUBE_HEDGE_MS = 2500;

async function fetchYouTubeBodyText(
  watchUrl: string,
): Promise<{ text: string; source: BodySource; viaProxy: boolean } | undefined> {
  const videoId = youTubeVideoId(watchUrl);
  if (!videoId) return undefined;

  // Empty player data, a bot-walled exit IP, or empty caption bodies are
  // per-IP or per-client flakes — a second attempt on a fresh session (new
  // exit IP when proxied) with the OTHER InnerTube client usually succeeds and
  // costs nothing, unlike the Supadata credit the fallback would burn.
  // "no_tracks" / "no_english_tracks" are facts about the video, not flakes:
  // skip the second client — unless the ASR tier missed with an audio stream
  // available (asrFlake), which is exit trouble, not video trouble.
  //
  // The second client is HEDGED, not serial: if the first hasn't answered
  // within INNERTUBE_HEDGE_MS it is probably stalling, so both race and the
  // first transcript wins. The common fast path never starts the second
  // request, so the extra cost only appears on captures that were already slow.
  const first = attemptYouTubeBodyText(videoId, INNERTUBE_CLIENTS[0]);
  let second: ReturnType<typeof attemptYouTubeBodyText> | undefined;
  const startSecond = () => (second ??= attemptYouTubeBodyText(videoId, INNERTUBE_CLIENTS[1]));

  let hedgeTimer: ReturnType<typeof setTimeout> | undefined;
  const hedged = new Promise<undefined>((resolve) => {
    hedgeTimer = setTimeout(() => {
      void startSecond();
      resolve(undefined);
    }, INNERTUBE_HEDGE_MS);
  });

  let attempt = await Promise.race([first, hedged]);
  if (attempt) {
    // First client answered before the hedge fired.
    clearTimeout(hedgeTimer);
    const factual =
      (attempt.failure === "no_tracks" || attempt.failure === "no_english_tracks") && !attempt.asrFlake;
    if (!attempt.text && !factual) {
      const retry = await startSecond();
      if (retry.text || (retry.description && !attempt.description)) attempt = retry;
    }
  } else {
    // Hedge fired: both clients are in flight — first transcript wins, and a
    // miss still waits for the other before falling through to Supadata.
    const winner = await Promise.race([
      first.then((r) => ({ r, other: () => startSecond() })),
      startSecond().then((r) => ({ r, other: () => first })),
    ]);
    attempt = winner.r;
    if (!attempt.text) {
      const other = await winner.other();
      if (other.text || (other.description && !attempt.description)) attempt = other;
    }
  }
  clearTimeout(hedgeTimer);

  if (attempt.text && attempt.source) {
    return { text: condenseToBudget(attempt.text), source: attempt.source, viaProxy: attempt.viaProxy };
  }

  // One structured line per miss so Render logs show exactly why the paid
  // Supadata fallback is being reached for YouTube.
  console.log(
    JSON.stringify({ event: "yt_transcript_miss", videoId, failure: attempt.failure ?? "unknown", viaProxy: attempt.viaProxy }),
  );

  // Fallback: the creator's description.
  const description = attempt.description?.trim();
  if (description && description.length >= 20) {
    return { text: description.slice(0, 6000), source: "description", viaProxy: attempt.viaProxy };
  }
  return undefined;
}

// ── Source-specific extractors ──────────────────────────────────────────────

function hostOf(parsed: URL): string {
  return parsed.hostname.replace(/^www\./, "").toLowerCase();
}

function isRedditHost(parsed: URL): boolean {
  const host = hostOf(parsed);
  return host === "reddit.com" || host.endsWith(".reddit.com") || host === "redd.it";
}

function isTikTokHost(parsed: URL): boolean {
  const host = hostOf(parsed);
  return host === "tiktok.com" || host.endsWith(".tiktok.com");
}

function isInstagramHost(parsed: URL): boolean {
  const host = hostOf(parsed);
  return host === "instagram.com" || host.endsWith(".instagram.com") || host === "instagr.am";
}

function isTwitterHost(parsed: URL): boolean {
  const host = hostOf(parsed);
  return host === "twitter.com" || host === "x.com" || host.endsWith(".twitter.com");
}

type RedditPost = {
  title?: string;
  selftext?: string;
  author?: string;
  subreddit_name_prefixed?: string;
  created_utc?: number;
  thumbnail?: string;
  url_overridden_by_dest?: string;
  permalink?: string;
};

/**
 * Reddit's public JSON API: append `.json` to any comments permalink. Returns
 * the post text plus the top substantive comments — for link/video posts the
 * discussion is usually where the actual content is.
 */
async function fetchRedditMetadata(normalized: string, originalUrl: string): Promise<ExtractedMetadata | undefined> {
  try {
    const jsonUrl = `${normalized.replace(/\/$/, "").split("?")[0]}.json?limit=12&raw_json=1`;
    type RedditPayload = { data?: { children?: { kind?: string; data?: RedditPost }[] } }[];

    let payload: RedditPayload | undefined;
    const direct = await fetchWithTimeout(jsonUrl, { headers: YT_HEADERS, redirect: "follow" }, 8000).catch(
      () => undefined,
    );
    if (direct?.ok) {
      payload = (await direct.json()) as RedditPayload;
    } else {
      // Reddit's public JSON API intermittently blocks datacenter IPs; one
      // retry through the residential proxy before giving up.
      const session = createProxySession();
      try {
        if (!session.viaProxy) return undefined;
        const retry = await session.fetch(jsonUrl, { headers: YT_HEADERS, redirect: "follow" }, 8000);
        if (!retry.ok) return undefined;
        payload = (await retry.json()) as RedditPayload;
      } finally {
        await session.close().catch(() => {});
      }
    }
    if (!payload) return undefined;
    const post = payload?.[0]?.data?.children?.[0]?.data;
    if (!post?.title) return undefined;

    const comments = (payload?.[1]?.data?.children ?? [])
      .filter((c) => c.kind === "t1")
      .map((c) => (c.data as { body?: string; score?: number } | undefined))
      .filter((d): d is { body: string; score?: number } =>
        typeof d?.body === "string" && d.body.trim().length >= 40 && d.body !== "[deleted]" && d.body !== "[removed]")
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, 5)
      .map((d) => d.body.replace(/\s+/g, " ").trim().slice(0, 700));

    const selftext = post.selftext?.trim();
    const parts = [
      selftext,
      comments.length > 0 ? `Top comments:\n${comments.join("\n")}` : undefined,
    ].filter(Boolean);
    const bodyText = parts.join("\n\n").slice(0, 8000) || undefined;

    const canonical = post.permalink
      ? normalizeUrl(`https://www.reddit.com${post.permalink}`)
      : normalizeUrl(normalized);

    return {
      title: post.title,
      description: selftext ? selftext.slice(0, 500) : comments[0]?.slice(0, 500),
      bodyText,
      bodySource: bodyText ? "reddit" : undefined,
      canonicalUrl: canonical,
      originalUrl,
      siteName: post.subreddit_name_prefixed ?? "Reddit",
      authorName: post.author ? `u/${post.author}` : undefined,
      publishedAt: post.created_utc ? new Date(post.created_utc * 1000) : undefined,
      sourceName: post.subreddit_name_prefixed ?? "Reddit",
      sourceDomain: "reddit.com",
      contentType: "post",
      imageUrl: post.thumbnail?.startsWith("http") ? post.thumbnail : undefined,
    };
  } catch {
    return undefined;
  }
}

/**
 * Supadata transcript API — the production-grade path for video/social
 * content. Our own YouTube scrape works from residential IPs but gets served
 * bot interstitials from datacenter IPs (i.e. the deployed backend), and
 * TikTok/Instagram are unscrapable walls. Env-gated: without SUPADATA_API_KEY
 * this tier is silently skipped. `mode=native` fetches existing captions only
 * (1 credit); `mode=auto` falls back to AI transcription for caption-less
 * short videos (2 credits/min).
 */
async function fetchSupadataTranscript(url: string, mode: "native" | "auto"): Promise<string | undefined> {
  const apiKey = process.env.SUPADATA_API_KEY;
  if (!apiKey) return undefined;

  try {
    // `native` (existing captions) responds quickly, so cap it tightly — it's
    // a rare fallback and the user is waiting on the capture sheet. `auto`
    // legitimately needs time when it falls back to AI transcription.
    // `lang=en`: without it Supadata picks an arbitrary caption track — it
    // returned Arabic transcripts for English videos (benchmarked 2026-07-13),
    // and that text flows straight into embeddings and topic classification.
    const timeoutMs = mode === "native" ? 8000 : 20000;
    const endpoint = `https://api.supadata.ai/v1/transcript?url=${encodeURIComponent(url)}&text=true&mode=${mode}&lang=en`;
    const res = await fetchWithTimeout(endpoint, { headers: { "x-api-key": apiKey } }, timeoutMs);
    if (!res.ok) return undefined;

    const payload = (await res.json()) as { content?: unknown };
    if (typeof payload.content !== "string") return undefined;
    const text = payload.content.replace(/\s+/g, " ").trim();
    return text.length >= 40 ? condenseToBudget(text) : undefined;
  } catch {
    return undefined;
  }
}

/** Tweet text via Twitter's free oEmbed endpoint (no auth required). */
async function fetchTweetMetadata(normalized: string, originalUrl: string): Promise<ExtractedMetadata | undefined> {
  try {
    const res = await fetchWithTimeout(
      `https://publish.twitter.com/oembed?url=${encodeURIComponent(normalized)}&omit_script=true`,
      { headers: { accept: "application/json" } },
      8000,
    );
    if (!res.ok) return undefined;

    const payload = (await res.json()) as { html?: string; author_name?: string };
    if (!payload.html) return undefined;

    const text = load(payload.html)("blockquote").text().replace(/\s+/g, " ").trim();
    if (text.length < 10) return undefined;

    return {
      title: text.length > 90 ? `${text.slice(0, 87).trimEnd()}…` : text,
      description: text,
      bodyText: text,
      bodySource: "body",
      canonicalUrl: normalizeUrl(normalized),
      originalUrl,
      siteName: "X",
      authorName: payload.author_name,
      sourceName: "X",
      sourceDomain: "x.com",
      contentType: "post",
    };
  } catch {
    return undefined;
  }
}

/**
 * Best-effort TikTok media URL from the page's rehydration JSON. TikTok
 * bot-walls datacenter (and many residential) IPs outright, so this runs
 * through the proxy session and is expected to miss often — the Supadata
 * fallback still covers those cases.
 */
async function fetchTikTokMediaUrl(url: string, session: ProxySession): Promise<string | undefined> {
  try {
    const res = await session.fetch(url, { headers: { ...YT_HEADERS, accept: "text/html" }, redirect: "follow" }, 8000);
    if (!res.ok) return undefined;
    const html = await res.text();
    const match = html.match(/"playAddr":"([^"]+)"/) ?? html.match(/"downloadAddr":"([^"]+)"/);
    if (!match) return undefined;
    // The URL sits inside a JSON string ("/" escapes etc.) — unescape it.
    const mediaUrl = JSON.parse(`"${match[1]}"`) as string;
    return mediaUrl.startsWith("http") ? mediaUrl : undefined;
  } catch {
    return undefined;
  }
}

/**
 * TikTok transcript, cheapest source first: Groq ASR over the scraped media
 * URL (~$0.0007/min) when configured, then Supadata mode=auto (2 credits/min).
 * The media download must reuse the scrape's proxy session — TikTok CDN URLs
 * are tied to the requesting IP.
 */
async function fetchTikTokTranscript(
  normalized: string,
): Promise<{ text: string; viaSupadata: boolean } | undefined> {
  if (groqConfigured()) {
    const session = createProxySession();
    try {
      const mediaUrl = await fetchTikTokMediaUrl(normalized, session);
      if (mediaUrl) {
        const result = await transcribeAudioUrl({
          url: mediaUrl,
          session,
          headers: { "user-agent": BROWSER_UA },
          filename: "video.mp4",
        });
        if (result) return { text: condenseToBudget(result.text), viaSupadata: false };
      }
    } finally {
      await session.close().catch(() => {});
    }
  }
  const supadata = await fetchSupadataTranscript(normalized, "auto");
  return supadata ? { text: supadata, viaSupadata: true } : undefined;
}

/** TikTok caption + author via oEmbed, plus a transcript when available. */
async function fetchTikTokMetadata(
  normalized: string,
  originalUrl: string,
  allowPaidTranscript: boolean,
): Promise<ExtractedMetadata | undefined> {
  try {
    const [oembedRes, transcript] = await Promise.all([
      fetchWithTimeout(
        `https://www.tiktok.com/oembed?url=${encodeURIComponent(normalized)}`,
        { headers: { accept: "application/json" } },
        8000,
      ).catch(() => undefined),
      // TikTok videos rarely have native captions, so allow AI transcription —
      // they are short, which keeps the per-video cost tiny.
      allowPaidTranscript ? fetchTikTokTranscript(normalized) : Promise.resolve(undefined),
    ]);

    let oembed: { title?: string; author_name?: string; thumbnail_url?: string } | undefined;
    if (oembedRes?.ok) {
      oembed = (await oembedRes.json()) as typeof oembed;
    }

    const title = clean(oembed?.title);
    if (!title && !transcript) return undefined;

    const text = transcript?.text;
    return {
      title: title ?? (text!.length > 90 ? `${text!.slice(0, 87).trimEnd()}…` : text!),
      description: text?.slice(0, 500) ?? title,
      bodyText: text ?? title,
      bodySource: text ? "transcript" : "description",
      usedSupadata: transcript?.viaSupadata ? true : undefined,
      canonicalUrl: normalizeUrl(normalized),
      originalUrl,
      siteName: "TikTok",
      authorName: clean(oembed?.author_name),
      imageUrl: clean(oembed?.thumbnail_url),
      sourceName: "TikTok",
      sourceDomain: "tiktok.com",
      contentType: "video",
    };
  } catch {
    return undefined;
  }
}

// ── PDF pipeline ────────────────────────────────────────────────────────────

/** PDFs above this are skipped: a paper is well under it, and parsing an
 * arbitrarily large scan would pin the capture path on CPU. */
const PDF_MAX_BYTES = 15 * 1024 * 1024;
/** Hard cap on parse time — a malformed PDF must degrade to thin, not hang. */
const PDF_PARSE_TIMEOUT_MS = 15000;

function isPdfUrl(parsed: URL): boolean {
  return parsed.pathname.toLowerCase().endsWith(".pdf");
}

/** Public form of isPdfUrl for callers holding a raw URL string. PDFs parse
 * locally (no paid tier), so re-extracting one is always safe. */
export function isPdfContentUrl(url: string): boolean {
  try {
    return isPdfUrl(new URL(normalizeUrl(url)));
  } catch {
    return false;
  }
}

function isPdfResponse(res: Response): boolean {
  return (res.headers?.get?.("content-type") ?? "").toLowerCase().includes("application/pdf");
}

/** Filename-derived title fallback: "Nagel_Bat.pdf" → "Nagel Bat". */
function pdfFilenameTitle(url: string): string | undefined {
  try {
    const name = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
    const cleaned = name.replace(/\.pdf$/i, "").replace(/[_\-+]+/g, " ").trim();
    return cleaned.length >= 3 ? cleaned : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Extracts text + metadata from a PDF. Documents shared into Mneme are very
 * often papers and essays as PDFs; before this pipeline existed they fell
 * through the HTML parsers (which chew on raw PDF bytes for the full timeout
 * ladder and produce nothing) and every one degraded to thin. Title comes from
 * the PDF's own metadata, then the first plausible text line, then the
 * filename. Best-effort: undefined on any failure.
 */
async function parsePdfMetadata(buffer: ArrayBuffer, url: string): Promise<ExtractedMetadata | undefined> {
  if (buffer.byteLength < 512 || buffer.byteLength > PDF_MAX_BYTES) return undefined;
  try {
    const result = await Promise.race([
      (async () => {
        const pdf = await getDocumentProxy(new Uint8Array(buffer));
        const [{ text }, meta] = await Promise.all([
          extractText(pdf, { mergePages: true }),
          getMeta(pdf).catch(() => undefined),
        ]);
        return { text, meta };
      })(),
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), PDF_PARSE_TIMEOUT_MS)),
    ]);
    if (!result) return undefined;

    // Strip NULLs and other control characters pdf.js can emit - Postgres
    // rejects any string containing 0x00 ("invalid byte sequence for encoding
    // UTF8"), which silently voided the whole row update for affected PDFs.
    const sanitize = (s: string) =>
      // eslint-disable-next-line no-control-regex
      s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
    const bodyText = sanitize(result.text).replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    if (bodyText.length < 200) return undefined; // scanned/image-only PDF — nothing to read

    const info = (result.meta?.info ?? {}) as Record<string, unknown>;
    const metaTitle = typeof info.Title === "string" ? info.Title.trim() : "";
    // First plausible text line — papers open with their title.
    const firstLine = bodyText
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length >= 8 && l.length <= 160);
    const title = (metaTitle.length >= 4 ? metaTitle : undefined) ?? firstLine ?? pdfFilenameTitle(url) ?? "PDF document";
    const authorName = typeof info.Author === "string" && info.Author.trim().length >= 2
      ? info.Author.trim()
      : undefined;

    const parsed = new URL(url);
    const sourceDomain = parsed.hostname.replace(/^www\./, "");
    return {
      title: title.slice(0, 200),
      description: undefined,
      bodyText: condenseToBudget(bodyText),
      bodySource: "pdf",
      canonicalUrl: normalizeUrl(url),
      originalUrl: url,
      authorName,
      sourceName: sourceDomain,
      sourceDomain,
      contentType: "document",
    };
  } catch {
    return undefined;
  }
}

/** Downloads and parses a PDF URL (the direct `.pdf` fast path). */
async function fetchPdfMetadata(normalized: string, originalUrl: string): Promise<ExtractedMetadata | undefined> {
  try {
    const res = await fetchWithTimeout(normalized, { headers: { "user-agent": BROWSER_UA, accept: "application/pdf,*/*" } }, 12000);
    if (!res.ok) return undefined;
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > PDF_MAX_BYTES) return undefined;
    return await parsePdfMetadata(await res.arrayBuffer(), originalUrl);
  } catch {
    return undefined;
  }
}

/** Hosts whose body text requires Supadata AI transcription (mode=auto,
 * 2 credits/min) — the per-capture cost worth metering per user. */
export function isPaidTranscriptHost(url: string): boolean {
  try {
    const parsed = new URL(normalizeUrl(url));
    return isTikTokHost(parsed) || isInstagramHost(parsed);
  } catch {
    return false;
  }
}

export async function fetchMetadata(
  url: string,
  opts: { allowPaidTranscript?: boolean } = {},
): Promise<{ metadata?: ExtractedMetadata; requiresManualInput: boolean }> {
  const allowPaidTranscript = opts.allowPaidTranscript ?? true;
  const normalized = normalizeUrl(url);
  const parsed = new URL(normalized);

  // Direct PDF links skip the HTML ladder entirely — its parsers can only
  // chew on the raw bytes for the full timeout chain and come back empty.
  if (isPdfUrl(parsed)) {
    const metadata = await fetchPdfMetadata(normalized, url);
    if (metadata) return { metadata, requiresManualInput: false };
    return { requiresManualInput: true };
  }

  if (isRedditHost(parsed)) {
    const metadata = await fetchRedditMetadata(normalized, url);
    if (metadata) {
      return { metadata, requiresManualInput: !metadata.title };
    }
    // fall through to the generic scrape on failure
  }

  if (isTwitterHost(parsed)) {
    const metadata = await fetchTweetMetadata(normalized, url);
    if (metadata) {
      return { metadata, requiresManualInput: false };
    }
  }

  if (isTikTokHost(parsed)) {
    const metadata = await fetchTikTokMetadata(normalized, url, allowPaidTranscript);
    if (metadata) {
      return { metadata, requiresManualInput: !metadata.title };
    }
  }

  if (parsed.hostname.includes("youtube.com") || parsed.hostname === "youtu.be") {
    // oEmbed (title/thumbnail) and the InnerTube caption fetch are
    // independent — run them concurrently to keep capture latency down.
    const [oembedResponse, scraped] = await Promise.all([
      fetchWithTimeout(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(normalized)}&format=json`,
        {},
        8000,
      ).catch(() => undefined),
      fetchYouTubeBodyText(normalized),
    ]);

    if (oembedResponse?.ok) {
      const payload = (await oembedResponse.json()) as {
        title?: string;
        author_name?: string;
        thumbnail_url?: string;
        provider_name?: string;
      };

      // In-house InnerTube caption fetch first; Supadata is only the paid
      // fallback. Native captions only — nearly every YouTube video has
      // them, and it keeps the cost at 1 credit per video.
      let body: { text: string; source: BodySource; viaProxy?: boolean; viaSupadata?: boolean } | undefined =
        scraped;
      if (!body || body.source !== "transcript") {
        const transcript = await fetchSupadataTranscript(normalized, "native");
        if (transcript) body = { text: transcript, source: "transcript", viaSupadata: true };
      }

      const metadata: ExtractedMetadata = {
        title: clean(payload.title),
        canonicalUrl: normalized,
        originalUrl: url,
        imageUrl: clean(payload.thumbnail_url),
        authorName: clean(payload.author_name),
        siteName: clean(payload.provider_name) ?? "YouTube",
        sourceName: clean(payload.provider_name) ?? "YouTube",
        sourceDomain: "youtube.com",
        contentType: "video",
        description: body?.text,
        bodyText: body?.text,
        bodySource: body?.source,
        usedProxy: body?.viaProxy || undefined,
        usedSupadata: body?.viaSupadata || undefined,
      };

      return {
        metadata,
        requiresManualInput: !metadata.title,
      };
    }
  }

  // Instagram has no public oEmbed and blocks scrapers; a Supadata transcript
  // is the only real content route. The generic scrape below still runs for
  // og:title/description.
  const instagramTranscript = isInstagramHost(parsed) && allowPaidTranscript
    ? await fetchSupadataTranscript(normalized, "auto")
    : undefined;

  // Many sites serve bots a stripped page (or a 403), so a browser-UA attempt
  // is usually needed anyway — run it concurrently with the polite MNEME-UA
  // fetch instead of serially after it. The browser response is only AWAITED
  // when the plain result is missing a title or body: when the polite fetch
  // already produced a full read, a slow browser-UA response can't improve it
  // (it was never consulted in that case) and shouldn't hold the capture.
  const plainPromise = fetchWithTimeout(normalized, {
    headers: {
      "user-agent": "MNEME/1.0 (+https://mneme.app)",
      accept: "text/html,application/xhtml+xml",
    },
  }, 8000).catch(() => undefined);
  const browserPromise = fetchWithTimeout(normalized, {
    headers: { ...YT_HEADERS, accept: "text/html,application/xhtml+xml" },
  }, 8000).catch(() => undefined);

  let metadata: ExtractedMetadata | undefined;
  try {
    const plainResponse = await plainPromise;
    if (plainResponse?.ok && isPdfResponse(plainResponse)) {
      // A PDF served from a non-.pdf URL (arxiv/doi-style links): parse the
      // bytes we already have instead of feeding them to the HTML parsers.
      metadata = await parsePdfMetadata(await plainResponse.arrayBuffer(), normalized);
      if (metadata) return { metadata, requiresManualInput: false };
    } else {
      metadata = plainResponse?.ok ? parseMetadataFromHtml(await plainResponse.text(), normalized) : undefined;
    }
  } catch {
    metadata = undefined;
  }

  if (!metadata?.title || !metadata.bodyText) {
    const browserResponse = await browserPromise;
    if (browserResponse?.ok) {
      try {
        if (isPdfResponse(browserResponse)) {
          const pdf = await parsePdfMetadata(await browserResponse.arrayBuffer(), normalized);
          if (pdf) return { metadata: pdf, requiresManualInput: false };
        } else {
          const retried = parseMetadataFromHtml(await browserResponse.text(), normalized);
          const better =
            !metadata?.title ||
            (Boolean(retried.title) && (retried.bodyText?.length ?? 0) > (metadata.bodyText?.length ?? 0));
          if (better && retried.title) {
            metadata = retried;
          }
        }
      } catch {
        // keep whatever the plain attempt produced
      }
    }
  }

  // Final tier: bot-walled sites (Cloudflare 403s, "Just a moment…" shells)
  // serve the real page to residential IPs. One proxied retry when configured.
  if (!metadata?.title || !metadata.bodyText) {
    const session = createProxySession();
    try {
      if (session.viaProxy) {
        const res = await session.fetch(
          normalized,
          { headers: { ...YT_HEADERS, accept: "text/html,application/xhtml+xml" } },
          12000,
        );
        if (res.ok) {
          const retried = parseMetadataFromHtml(await res.text(), normalized);
          const better =
            !metadata?.title ||
            (Boolean(retried.title) && (retried.bodyText?.length ?? 0) > (metadata.bodyText?.length ?? 0));
          if (better && retried.title) {
            metadata = { ...retried, usedProxy: true };
          }
        }
      }
    } catch {
      // keep whatever the direct attempts produced
    } finally {
      await session.close().catch(() => {});
    }
  }

  if (instagramTranscript && metadata) {
    metadata.bodyText = instagramTranscript;
    metadata.bodySource = "transcript";
    metadata.usedSupadata = true;
    metadata.description = metadata.description ?? instagramTranscript.slice(0, 500);
  } else if (instagramTranscript && !metadata) {
    metadata = {
      title: instagramTranscript.length > 90 ? `${instagramTranscript.slice(0, 87).trimEnd()}…` : instagramTranscript,
      description: instagramTranscript.slice(0, 500),
      bodyText: instagramTranscript,
      bodySource: "transcript",
      usedSupadata: true,
      canonicalUrl: normalized,
      originalUrl: url,
      siteName: "Instagram",
      sourceName: "Instagram",
      sourceDomain: "instagram.com",
      contentType: "video",
    };
  }

  if (!metadata) {
    return { requiresManualInput: true };
  }

  const requiresManualInput = !metadata.title || !metadata.canonicalUrl;

  return {
    metadata,
    requiresManualInput,
  };
}

export function sourceSlug(name: string) {
  return slugify(name, { lower: true, strict: true, trim: true });
}
