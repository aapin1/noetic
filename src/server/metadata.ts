import { load } from "cheerio";
import slugify from "slugify";
import { normalizeUrl } from "@/server/url";

export type BodySource = "transcript" | "body" | "jsonld" | "reddit" | "description";

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

  return {
    articleBody: articleBody?.slice(0, 6000),
    description: description?.slice(0, 6000),
  };
}

/** Pulls readable body text out of an article page (best-effort, no readability dep). */
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
  return joined.length >= 40 ? joined.slice(0, 6000) : undefined;
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
  const domBody = extractBodyText($);
  // Prefer the longer of DOM body vs JSON-LD articleBody; fall back to a
  // long-form JSON-LD description (podcast show notes) when the page has no
  // readable body at all.
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

/** Returns the balanced JSON literal (array or object) starting at `start`. */
function sliceBalancedJson(text: string, start: number): string | undefined {
  const open = text[start];
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return undefined;
}

// A real browser UA + consent cookie. YouTube serves a stripped consent/bot
// interstitial (no captionTracks) to non-browser agents, which is why the
// transcript scrape was intermittently empty.
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const YT_HEADERS = {
  "user-agent": BROWSER_UA,
  "accept-language": "en-US,en;q=0.9",
  cookie: "CONSENT=YES+cb.20210328-17-p0.en+FX+000",
} as const;

type CaptionTrack = { baseUrl?: string; languageCode?: string; kind?: string };

/** Reads the caption track list embedded in the watch page HTML. */
function parseCaptionTracks(html: string): CaptionTrack[] {
  const marker = '"captionTracks":';
  const at = html.indexOf(marker);
  if (at === -1) return [];
  const arr = sliceBalancedJson(html, at + marker.length);
  if (!arr) return [];
  try {
    return JSON.parse(arr) as CaptionTrack[];
  } catch {
    return [];
  }
}

/** Fetches and flattens a timedtext caption track into plain transcript text. */
async function fetchTranscriptText(baseUrl: string): Promise<string | undefined> {
  const res = await fetch(`${baseUrl}&fmt=json3`, {
    headers: YT_HEADERS,
  });
  if (!res.ok) return undefined;
  const data = (await res.json()) as { events?: { segs?: { utf8?: string }[] }[] };
  const text = (data.events ?? [])
    .flatMap((ev) => ev.segs ?? [])
    .map((seg) => seg.utf8 ?? "")
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return text.length >= 40 ? text.slice(0, 10000) : undefined;
}

/** Fetches the watch-page HTML, retrying once past YouTube's captionless interstitial. */
async function fetchYouTubeWatchHtml(watchUrl: string): Promise<string | undefined> {
  // Two attempts: YouTube occasionally serves a captionless interstitial on the
  // first hit even with the consent cookie set.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(watchUrl, {
        headers: { ...YT_HEADERS, accept: "text/html,application/xhtml+xml" },
      });
      if (res.ok) {
        const html = await res.text();
        if (html.includes('"captionTracks":') || html.includes('"shortDescription":')) {
          return html;
        }
      }
    } catch {
      // retry
    }
  }
  return undefined;
}

/**
 * Extracts substantive body text for a YouTube video. A video has no article
 * body, so the transcript is the real content the insight and embedding work
 * from; the creator-written description is only a fallback since it's often
 * empty or link spam. Best-effort: returns undefined on any failure.
 */
async function fetchYouTubeBodyText(watchUrl: string): Promise<{ text: string; source: BodySource } | undefined> {
  try {
    const html = await fetchYouTubeWatchHtml(watchUrl);
    if (!html) return undefined;

    const tracks = parseCaptionTracks(html);
    if (tracks.length > 0) {
      // Prefer a human-authored English track; fall back to any English track,
      // then to whatever caption exists (usually auto-generated).
      const pick =
        tracks.find((t) => t.languageCode?.startsWith("en") && t.kind !== "asr") ??
        tracks.find((t) => t.languageCode?.startsWith("en")) ??
        tracks[0];
      if (pick?.baseUrl) {
        const transcript = await fetchTranscriptText(pick.baseUrl);
        if (transcript) return { text: transcript, source: "transcript" };
      }
    }

    // Fallback: the creator's description from the ytInitialPlayerResponse blob.
    const match = html.match(/"shortDescription":"((?:\\.|[^"\\])*)"/);
    if (match) {
      const description = (JSON.parse(`"${match[1]}"`) as string).trim();
      if (description.length >= 20) return { text: description.slice(0, 6000), source: "description" };
    }
    return undefined;
  } catch {
    return undefined;
  }
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
    const res = await fetchWithTimeout(jsonUrl, { headers: YT_HEADERS, redirect: "follow" }, 10000);
    if (!res.ok) return undefined;

    const payload = (await res.json()) as {
      data?: { children?: { kind?: string; data?: RedditPost }[] };
    }[];
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
    const endpoint = `https://api.supadata.ai/v1/transcript?url=${encodeURIComponent(url)}&text=true&mode=${mode}`;
    const res = await fetchWithTimeout(endpoint, { headers: { "x-api-key": apiKey } }, 25000);
    if (!res.ok) return undefined;

    const payload = (await res.json()) as { content?: unknown };
    if (typeof payload.content !== "string") return undefined;
    const text = payload.content.replace(/\s+/g, " ").trim();
    return text.length >= 40 ? text.slice(0, 10000) : undefined;
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

/** TikTok caption + author via oEmbed, plus a Supadata transcript when available. */
async function fetchTikTokMetadata(normalized: string, originalUrl: string): Promise<ExtractedMetadata | undefined> {
  try {
    const [oembedRes, transcript] = await Promise.all([
      fetchWithTimeout(
        `https://www.tiktok.com/oembed?url=${encodeURIComponent(normalized)}`,
        { headers: { accept: "application/json" } },
        8000,
      ).catch(() => undefined),
      // TikTok videos rarely have native captions, so allow AI transcription —
      // they are short, which keeps the per-video cost tiny.
      fetchSupadataTranscript(normalized, "auto"),
    ]);

    let oembed: { title?: string; author_name?: string; thumbnail_url?: string } | undefined;
    if (oembedRes?.ok) {
      oembed = (await oembedRes.json()) as typeof oembed;
    }

    const title = clean(oembed?.title);
    if (!title && !transcript) return undefined;

    return {
      title: title ?? (transcript!.length > 90 ? `${transcript!.slice(0, 87).trimEnd()}…` : transcript!),
      description: transcript?.slice(0, 500) ?? title,
      bodyText: transcript ?? title,
      bodySource: transcript ? "transcript" : "description",
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

export async function fetchMetadata(url: string): Promise<{ metadata?: ExtractedMetadata; requiresManualInput: boolean }> {
  const normalized = normalizeUrl(url);
  const parsed = new URL(normalized);

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
    const metadata = await fetchTikTokMetadata(normalized, url);
    if (metadata) {
      return { metadata, requiresManualInput: !metadata.title };
    }
  }

  if (parsed.hostname.includes("youtube.com") || parsed.hostname === "youtu.be") {
    const oembedResponse = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(normalized)}&format=json`);

    if (oembedResponse.ok) {
      const payload = (await oembedResponse.json()) as {
        title?: string;
        author_name?: string;
        thumbnail_url?: string;
        provider_name?: string;
      };

      // Our own caption scrape works from residential IPs; in production
      // (datacenter IP) YouTube serves a captionless interstitial, so fall back
      // to Supadata for the transcript. Native captions only — nearly every
      // YouTube video has them, and it keeps the cost at 1 credit per video.
      let body = await fetchYouTubeBodyText(normalized);
      if (!body || body.source !== "transcript") {
        const transcript = await fetchSupadataTranscript(normalized, "native");
        if (transcript) body = { text: transcript, source: "transcript" };
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
  const instagramTranscript = isInstagramHost(parsed)
    ? await fetchSupadataTranscript(normalized, "auto")
    : undefined;

  let response: Response | undefined;
  try {
    response = await fetchWithTimeout(normalized, {
      headers: {
        "user-agent": "MNEME/1.0 (+https://mneme.app)",
        accept: "text/html,application/xhtml+xml",
      },
    }, 12000);
  } catch {
    response = undefined;
  }

  let metadata = response?.ok ? parseMetadataFromHtml(await response.text(), normalized) : undefined;

  // Many sites serve bots a stripped page (or a 403). Retry once as a real
  // browser before giving up or settling for title-only metadata.
  if (!metadata?.title || !metadata.bodyText) {
    try {
      const retry = await fetchWithTimeout(normalized, {
        headers: { ...YT_HEADERS, accept: "text/html,application/xhtml+xml" },
      }, 12000);
      if (retry.ok) {
        const retried = parseMetadataFromHtml(await retry.text(), normalized);
        const better =
          !metadata?.title ||
          (Boolean(retried.title) && (retried.bodyText?.length ?? 0) > (metadata.bodyText?.length ?? 0));
        if (better && retried.title) {
          metadata = retried;
        }
      }
    } catch {
      // keep whatever the first attempt produced
    }
  }

  if (instagramTranscript && metadata) {
    metadata.bodyText = instagramTranscript;
    metadata.bodySource = "transcript";
    metadata.description = metadata.description ?? instagramTranscript.slice(0, 500);
  } else if (instagramTranscript && !metadata) {
    metadata = {
      title: instagramTranscript.length > 90 ? `${instagramTranscript.slice(0, 87).trimEnd()}…` : instagramTranscript,
      description: instagramTranscript.slice(0, 500),
      bodyText: instagramTranscript,
      bodySource: "transcript",
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
