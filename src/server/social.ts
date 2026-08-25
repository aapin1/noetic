/**
 * TikTok + Instagram extraction — the sources real captures turned out to be
 * mostly made of (2026-08: nearly all real-world captures were short-form
 * video, and only ~1 in 6 got a transcript).
 *
 * Self-hosted ladder first, paid backstop last, then the visuals:
 *   TikTok    page JSON → TikTok's own English captions (creator or ASR, free)
 *             → player API media → Whisper ASR (Groq, then OpenAI)
 *             → Supadata (paid, metered per user)
 *             → no speech at all? → vision over the cover frames / slides
 *   Instagram embed page JSON → video_url → Whisper ASR → Supadata
 *             → photo, carousel, or speechless reel → vision over the slides
 * A post whose whole argument is burned-in text (slideshows, quote cards,
 * "text + music" videos) is read off its images; the caption, on-screen
 * stickers and Instagram's own alt text ride along in every case.
 *
 * Hard-won facts (verified live 2026-08-24, all from a residential IP and
 * through the Decodo proxy):
 * - TikTok serves the item JSON for ANY `/@user/video/{id}` path — the
 *   username is decorative, so short links only need to resolve to an id.
 * - `www.tiktok.com/player/api/v1/items?item_ids=` (the embed player's API)
 *   answers without cookies and its `url_list` media downloads with no
 *   headers at all; the page's own `playAddr` 403s without cookies. Cover
 *   frames and slideshow images download plainly too.
 * - Instagram's `/p/{sc}/embed/` page (iPhone UA) inlines a triple-escaped
 *   `gql_data.shortcode_media` with `video_url`, caption, owner, carousel
 *   children; GraphQL, `?__a=1` and the `api/v1` routes are login-walled.
 *   `instagram.com/{user}/reel/{sc}/` is a real, non-redirecting URL shape.
 * - `i.instagram.com/api/v1/oembed/` still returns caption + author.
 * Every request tries a direct fetch first (free) and falls back to the
 * residential proxy only when the direct read is unusable.
 */
import { readSocialFrames } from "@/server/cognition/llm";
import { BROWSER_UA, IPHONE_UA, condenseToBudget, fetchWithTimeout } from "@/server/extract-util";
import type { BodySource, ExtractedMetadata } from "@/server/metadata";
import { createProxySession, type ProxySession } from "@/server/proxyFetch";
import { fetchSupadataTranscript } from "@/server/supadata";
import { MAX_AUDIO_BYTES, asrConfigured, transcribeMediaUrl } from "@/server/transcribe";

export type SocialOpts = { allowPaidTranscript: boolean };
type TranscriptSource = "native_captions" | "groq" | "openai" | "supadata";
type Transcript = { text: string; source: TranscriptSource; viaProxy?: boolean };

/** Body text must carry at least this much to count as a transcript rather
 * than a speechless clip's noise ("Thank you." / "We'll see you next time."). */
const MIN_TRANSCRIPT_CHARS = 40;
/** Frames/slides sent to the vision model per post (cost bound). */
const MAX_FRAMES = 6;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

export function isTikTokHost(parsed: URL): boolean {
  const host = parsed.hostname.toLowerCase();
  return host === "tiktok.com" || host.endsWith(".tiktok.com");
}

export function isInstagramHost(parsed: URL): boolean {
  const host = parsed.hostname.toLowerCase();
  return host === "instagram.com" || host.endsWith(".instagram.com") || host === "instagr.am";
}

/** Hosts whose body text may cost a paid Supadata transcription. */
export function isSocialVideoUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return isTikTokHost(parsed) || isInstagramHost(parsed);
  } catch {
    return false;
  }
}

function clean(value: unknown): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? trimmed : undefined;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** A capture title from a caption: first line, sentence-trimmed to ~90 chars. */
function titleFromText(text: string, fallback: string): string {
  const first = text.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
  if (!first) return fallback;
  if (first.length <= 90) return first;
  const cut = first.slice(0, 87);
  const atBoundary = cut.replace(/\s+\S*$/, "");
  return `${(atBoundary.length > 30 ? atBoundary : cut).trimEnd()}…`;
}

/**
 * Body text, most substantive source first: the transcript when there is
 * speech; otherwise what the vision pass read off the frames/slides; the
 * caption, on-screen stickers and platform alt text ride along in every
 * case — the caption carries the creator's framing and hashtags (topic
 * signal), the visuals carry the argument a speechless post makes.
 */
function composeBody(parts: {
  transcript?: string;
  frames?: string;
  caption?: string;
  onScreen?: string[];
  altText?: string[];
}): { bodyText?: string; bodySource?: BodySource } {
  const extras: string[] = [];
  if (parts.caption) extras.push(`Caption: ${parts.caption}`);
  if (parts.onScreen?.length) extras.push(`On-screen text: ${parts.onScreen.join(" / ")}`);
  if (parts.altText?.length) extras.push(`Alt text: ${parts.altText.join(" / ")}`);

  if (parts.transcript) {
    const frames = parts.frames ? [`Frames: ${parts.frames}`] : [];
    return { bodyText: condenseToBudget([parts.transcript, ...extras, ...frames].join("\n\n")), bodySource: "transcript" };
  }
  if (parts.frames) {
    return { bodyText: condenseToBudget([parts.frames, ...extras].join("\n\n")), bodySource: "vision" };
  }
  const fallback = [parts.caption, ...extras.filter((e) => !e.startsWith("Caption:"))].filter(Boolean).join("\n\n");
  return fallback ? { bodyText: condenseToBudget(fallback), bodySource: "description" } : {};
}

// ---------------------------------------------------------------------------
// Direct-then-proxy fetching
// ---------------------------------------------------------------------------

type Fetched = { status: number; body: string; viaProxy: boolean };

/**
 * GET as text: direct first, then through the residential proxy when the
 * direct read is refused or `usable` rejects it (bot shells come back as a
 * 200 with none of the data — status alone can't tell).
 */
async function fetchText(
  url: string,
  headers: Record<string, string>,
  session: ProxySession,
  timeoutMs: number,
  usable: (status: number, body: string) => boolean,
): Promise<Fetched | undefined> {
  let direct: Fetched | undefined;
  try {
    const res = await fetchWithTimeout(url, { headers, redirect: "follow" }, timeoutMs);
    direct = { status: res.status, body: await res.text(), viaProxy: false };
    if (usable(direct.status, direct.body)) return direct;
  } catch {
    // fall through to the proxy
  }
  if (!session.viaProxy) return direct && usable(direct.status, direct.body) ? direct : undefined;
  try {
    const res = await session.fetch(url, { headers, redirect: "follow" }, timeoutMs);
    const proxied = { status: res.status, body: await res.text(), viaProxy: true };
    return usable(proxied.status, proxied.body) ? proxied : undefined;
  } catch {
    return undefined;
  }
}

/** GET as bytes (images): direct first, proxy on refusal. Size-capped. */
async function fetchBytes(
  url: string,
  session: ProxySession,
  timeoutMs: number,
): Promise<{ bytes: Buffer; mimeType: string; viaProxy: boolean } | undefined> {
  const attempt = async (viaProxy: boolean) => {
    const init = { headers: { "user-agent": IPHONE_UA, accept: "image/*,*/*;q=0.8" } };
    const res = viaProxy ? await session.fetch(url, init, timeoutMs) : await fetchWithTimeout(url, init, timeoutMs);
    if (!res.ok) return undefined;
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) return undefined;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return undefined;
    const mimeType = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim() || "image/jpeg";
    return { bytes, mimeType, viaProxy };
  };
  try {
    const direct = await attempt(false);
    if (direct) return direct;
  } catch {
    // fall through
  }
  if (!session.viaProxy) return undefined;
  try {
    return await attempt(true);
  } catch {
    return undefined;
  }
}

function jsonOrUndefined<T>(body: string): T | undefined {
  try {
    return JSON.parse(body) as T;
  } catch {
    return undefined;
  }
}

/**
 * Follows share-sheet short links (vm.tiktok.com/…, tiktok.com/t/…,
 * instagram.com/share/…) to the canonical post URL without executing the
 * page. Direct first, proxy second: the short-link hosts themselves are
 * sometimes bot-walled from datacenter IPs.
 */
async function resolveRedirects(url: string, session: ProxySession): Promise<string> {
  const hop = async (current: string, viaProxy: boolean): Promise<string | undefined> => {
    const init = { headers: { "user-agent": IPHONE_UA }, redirect: "manual" as const };
    const res = viaProxy ? await session.fetch(current, init, 8000) : await fetchWithTimeout(current, init, 8000);
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      return location ? new URL(location, current).toString() : undefined;
    }
    return undefined;
  };
  let current = url;
  for (let i = 0; i < 4; i++) {
    let next: string | undefined;
    try {
      next = await hop(current, false);
    } catch {
      next = undefined;
    }
    if (!next && session.viaProxy) {
      try {
        next = await hop(current, true);
      } catch {
        next = undefined;
      }
    }
    if (!next) break;
    current = next;
  }
  return current;
}

// ---------------------------------------------------------------------------
// Vision over frames / slides
// ---------------------------------------------------------------------------

/**
 * Reads the text off up to MAX_FRAMES images (cover frames of a speechless
 * video, the slides of a photo post or carousel). Returns the frame text and
 * whether any image came through the proxy.
 */
async function readFrames(
  urls: string[],
  caption: string | undefined,
  session: ProxySession,
): Promise<{ text: string; viaProxy: boolean; frames: number } | undefined> {
  const unique = [...new Set(urls.filter(Boolean))];
  if (unique.length === 0 || !process.env.OPENAI_API_KEY) return undefined;
  const picked = unique.slice(0, MAX_FRAMES);
  const loaded = (await Promise.all(picked.map((u) => fetchBytes(u, session, 12000)))).filter(
    (x): x is NonNullable<typeof x> => Boolean(x),
  );
  if (loaded.length === 0) return undefined;
  const text = await readSocialFrames({
    images: loaded.map((img) => ({ base64: img.bytes.toString("base64"), mimeType: img.mimeType })),
    caption,
  });
  if (!text || text.length < 20) return undefined;
  const elided = unique.length > picked.length ? `${text}\n[… ${unique.length - picked.length} more slides not shown]` : text;
  return { text: elided, viaProxy: loaded.some((img) => img.viaProxy), frames: loaded.length };
}

// ---------------------------------------------------------------------------
// WebVTT
// ---------------------------------------------------------------------------

/** Cue text from a WebVTT document: headers, timings, cue ids, and tags
 * dropped; rolling-caption repeats collapsed. */
export function parseWebVtt(vtt: string): string {
  const lines: string[] = [];
  let inNote = false;
  for (const raw of vtt.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      inNote = false;
      continue;
    }
    if (/^WEBVTT/.test(line) || /^(NOTE|STYLE|REGION)\b/.test(line)) {
      inNote = true;
      continue;
    }
    if (inNote) continue;
    if (line.includes("-->") || /^\d+$/.test(line)) continue;
    const text = decodeEntities(line.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
    if (!text || text === lines[lines.length - 1]) continue;
    lines.push(text);
  }
  return lines.join(" ").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// TikTok
// ---------------------------------------------------------------------------

/** `/@user/video/ID`, `/@user/photo/ID` (slideshows), `m.tiktok.com/v/ID.html`,
 * `/embed/v2/ID`, `/embed/ID`. Short links (vm./vt./tiktok.com/t/) carry no id. */
const TIKTOK_ID_RE = /\/(?:video|photo|v|embed(?:\/v2)?)\/(\d{15,22})/;

type TikTokOembed = {
  title?: string;
  author_name?: string;
  author_unique_id?: string;
  thumbnail_url?: string;
  embed_product_id?: string | number;
};

type TikTokSubtitle = { LanguageCodeName?: string; Url?: string; Format?: string; Source?: string };

type TikTokPage = {
  desc?: string;
  authorId?: string;
  authorName?: string;
  cover?: string;
  /** Cover frames (creator-chosen cover + the first frame) for vision. */
  frames: string[];
  /** Slideshow (photo mode) images, in order. */
  images: string[];
  imageTitle?: string;
  captionUrl?: string;
  onScreen: string[];
  viaProxy: boolean;
};

type TikTokPlayer = {
  desc?: string;
  authorId?: string;
  authorName?: string;
  mediaUrl?: string;
  viaProxy: boolean;
};

async function fetchTikTokOembed(url: string): Promise<TikTokOembed | undefined> {
  try {
    const res = await fetchWithTimeout(
      `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`,
      { headers: { accept: "application/json", "user-agent": BROWSER_UA } },
      8000,
    );
    if (!res.ok) return undefined;
    return (await res.json()) as TikTokOembed;
  } catch {
    return undefined;
  }
}

/** The item JSON TikTok inlines in its video page (`webapp.video-detail` for
 * desktop UAs, `webapp.reflow.video.detail` for phones). */
export function parseTikTokPage(html: string): Omit<TikTokPage, "viaProxy"> | undefined {
  const match = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) return undefined;
  const data = jsonOrUndefined<{ __DEFAULT_SCOPE__?: Record<string, { itemInfo?: { itemStruct?: Record<string, unknown> } }> }>(match[1]);
  const scope = data?.__DEFAULT_SCOPE__;
  const item = (scope?.["webapp.video-detail"] ?? scope?.["webapp.reflow.video.detail"])?.itemInfo?.itemStruct;
  if (!item) return undefined;

  const video = item.video as { subtitleInfos?: TikTokSubtitle[]; cover?: string; originCover?: string } | undefined;
  const subtitles = (video?.subtitleInfos ?? []).filter((s) => clean(s.Url) && /^en/i.test(s.LanguageCodeName ?? ""));
  // Creator-authored captions beat TikTok's ASR track; English only — a
  // wrong-language track pollutes embeddings worse than no track at all.
  const pick = subtitles.find((s) => /creator/i.test(s.Source ?? "")) ?? subtitles[0];
  const author = item.author as { uniqueId?: string; nickname?: string } | undefined;
  const stickers = (item.stickersOnItem as { stickerText?: string[] }[] | undefined) ?? [];
  const onScreen = stickers.flatMap((s) => s.stickerText ?? []).map((t) => t.trim()).filter(Boolean);
  const imagePost = item.imagePost as { title?: string; images?: { imageURL?: { urlList?: string[] } }[] } | undefined;
  const images = (imagePost?.images ?? []).map((i) => clean(i.imageURL?.urlList?.[0])).filter((u): u is string => Boolean(u));
  const frames = [clean(video?.cover), clean(video?.originCover)].filter((u): u is string => Boolean(u));

  return {
    desc: clean(item.desc),
    authorId: clean(author?.uniqueId),
    authorName: clean(author?.nickname),
    cover: clean(video?.cover) ?? images[0],
    frames,
    images,
    imageTitle: clean(imagePost?.title),
    captionUrl: pick?.Url,
    onScreen,
  };
}

async function fetchTikTokPage(videoId: string, session: ProxySession): Promise<TikTokPage | undefined> {
  const fetched = await fetchText(
    `https://www.tiktok.com/@_/video/${videoId}`,
    { "user-agent": IPHONE_UA, accept: "text/html", "accept-language": "en-US,en;q=0.9" },
    session,
    12000,
    (status, body) => status === 200 && body.includes("__UNIVERSAL_DATA_FOR_REHYDRATION__") && body.includes("itemStruct"),
  );
  if (!fetched) return undefined;
  const parsed = parseTikTokPage(fetched.body);
  return parsed ? { ...parsed, viaProxy: fetched.viaProxy } : undefined;
}

/** Lowest-bitrate rendition that fits the ASR size cap, from the embed
 * player's item API. */
export function parseTikTokPlayer(json: unknown): Omit<TikTokPlayer, "viaProxy"> | undefined {
  const item = (json as { items?: Record<string, unknown>[] } | undefined)?.items?.[0];
  if (!item) return undefined;
  const info = item.video_info as
    | { url_list?: string[]; profiles?: { bitrate?: number; play_addr?: { data_size?: number; url_list?: string[] } }[] }
    | undefined;
  const profiles = (info?.profiles ?? [])
    .filter((p) => clean(p.play_addr?.url_list?.[0]))
    .sort((a, b) => (a.bitrate ?? 0) - (b.bitrate ?? 0));
  const fitting = profiles.find((p) => !p.play_addr?.data_size || p.play_addr.data_size <= MAX_AUDIO_BYTES) ?? profiles[0];
  const author = item.author_info as { unique_id?: string; nickname?: string } | undefined;
  return {
    desc: clean(item.desc),
    authorId: clean(author?.unique_id),
    authorName: clean(author?.nickname),
    mediaUrl: fitting?.play_addr?.url_list?.[0] ?? clean(info?.url_list?.[0]),
  };
}

async function fetchTikTokPlayer(videoId: string, session: ProxySession): Promise<TikTokPlayer | undefined> {
  const fetched = await fetchText(
    `https://www.tiktok.com/player/api/v1/items?item_ids=${videoId}`,
    { "user-agent": IPHONE_UA, accept: "application/json" },
    session,
    8000,
    (status, body) => status === 200 && body.includes('"items"') && body.includes("video_info"),
  );
  if (!fetched) return undefined;
  const parsed = parseTikTokPlayer(jsonOrUndefined(fetched.body));
  return parsed ? { ...parsed, viaProxy: fetched.viaProxy } : undefined;
}

async function fetchTikTokCaptions(captionUrl: string, session: ProxySession): Promise<Transcript | undefined> {
  const fetched = await fetchText(captionUrl, { "user-agent": IPHONE_UA }, session, 8000, (status, body) => status === 200 && body.length > 0);
  if (!fetched) return undefined;
  const text = parseWebVtt(fetched.body);
  return text.length >= MIN_TRANSCRIPT_CHARS ? { text, source: "native_captions", viaProxy: fetched.viaProxy } : undefined;
}

const stageMs = (label: string, started: number) => `${label}/${Date.now() - started}ms`;

export async function fetchTikTokMetadata(
  normalized: string,
  originalUrl: string,
  opts: SocialOpts,
): Promise<ExtractedMetadata | undefined> {
  const started = Date.now();
  const stages: Record<string, string> = {};
  const session = createProxySession();
  try {
    let videoId = TIKTOK_ID_RE.exec(new URL(normalized).pathname)?.[1];
    const oembedPromise = fetchTikTokOembed(normalized);

    if (!videoId) {
      // Share-sheet short links (vm.tiktok.com/…, vt.tiktok.com/…,
      // tiktok.com/t/…): oEmbed resolves them to the item id; redirect-
      // following is the backup.
      const oembed = await oembedPromise;
      const fromOembed = String(oembed?.embed_product_id ?? "");
      videoId = /^\d{15,22}$/.test(fromOembed) ? fromOembed : undefined;
      if (!videoId) {
        const resolved = await resolveRedirects(normalized, session);
        videoId = TIKTOK_ID_RE.exec(new URL(resolved).pathname)?.[1];
      }
      stages.id = videoId ? "resolved" : "miss";
    }

    const t0 = Date.now();
    const [oembed, page, player] = await Promise.all([
      oembedPromise,
      videoId ? fetchTikTokPage(videoId, session) : undefined,
      videoId ? fetchTikTokPlayer(videoId, session) : undefined,
    ]);
    stages.fetchMs = String(Date.now() - t0);
    stages.oembed = oembed?.title ? "ok" : "miss";
    stages.page = page
      ? `${page.images.length > 0 ? `photos(${page.images.length})` : page.captionUrl ? "captions" : "no_captions"}${page.viaProxy ? "/proxy" : ""}`
      : "miss";
    stages.player = player ? (player.mediaUrl ? `media${player.viaProxy ? "/proxy" : ""}` : "no_media") : "miss";

    const isPhotoPost = (page?.images.length ?? 0) > 0;
    const caption = clean(page?.desc) ?? clean(page?.imageTitle) ?? clean(player?.desc) ?? clean(oembed?.title);
    const authorId = page?.authorId ?? player?.authorId ?? clean(oembed?.author_unique_id);
    const authorName = page?.authorName ?? player?.authorName ?? clean(oembed?.author_name);
    const canonicalUrl =
      videoId && authorId ? `https://www.tiktok.com/@${authorId}/${isPhotoPost ? "photo" : "video"}/${videoId}` : normalized;

    let transcript: Transcript | undefined;
    let speechless = false;
    if (page?.captionUrl) {
      const t1 = Date.now();
      transcript = await fetchTikTokCaptions(page.captionUrl, session);
      stages.captions = stageMs(transcript ? "ok" : "miss", t1);
    }
    if (!transcript && !isPhotoPost && player?.mediaUrl && asrConfigured()) {
      const t1 = Date.now();
      const asr = await transcribeMediaUrl({
        url: player.mediaUrl,
        session,
        headers: { "user-agent": IPHONE_UA },
        filename: "video.mp4",
      });
      if ("failure" in asr) {
        speechless = asr.failure === "short_text";
        stages.asr = stageMs(`miss:${asr.failure}`, t1);
      } else {
        transcript = { text: asr.text, source: asr.provider, viaProxy: asr.viaProxy };
        stages.asr = stageMs(`${asr.provider}${asr.viaProxy ? "/proxy" : ""}`, t1);
      }
    }
    // The paid backstop only when ASR could not be run at all — a clip our
    // own ASR decoded as speechless would just cost a credit to hear again.
    if (!transcript && !isPhotoPost && !speechless && opts.allowPaidTranscript) {
      const t1 = Date.now();
      const paid = await fetchSupadataTranscript(canonicalUrl, "auto");
      if (paid) transcript = { text: paid, source: "supadata" };
      stages.supadata = stageMs(paid ? "ok" : "miss", t1);
    }

    // No speech: the post's content is what is on screen — slideshow images
    // or the cover frames of a text-over-video clip.
    let frames: { text: string; viaProxy: boolean } | undefined;
    if (!transcript) {
      // Slides for a photo post; otherwise the cover frames (the oEmbed
      // thumbnail is the same cover — only worth sending when the page missed).
      const urls = isPhotoPost ? page!.images : page?.frames.length ? page.frames : [clean(oembed?.thumbnail_url) ?? ""];
      const t1 = Date.now();
      const read = await readFrames(urls, caption, session);
      if (read) frames = read;
      stages.vision = stageMs(read ? `ok(${read.frames})${read.viaProxy ? "/proxy" : ""}` : "miss", t1);
    }

    if (!caption && !transcript && !frames) return undefined;

    const body = composeBody({ transcript: transcript?.text, frames: frames?.text, caption, onScreen: page?.onScreen ?? [] });
    const usedProxy = Boolean(page?.viaProxy || player?.viaProxy || transcript?.viaProxy || frames?.viaProxy);
    console.log(
      JSON.stringify({
        event: "social_extraction",
        host: "tiktok.com",
        id: videoId ?? null,
        kind: isPhotoPost ? "photo" : "video",
        transcript: transcript?.source ?? null,
        bodySource: body.bodySource ?? null,
        usedProxy,
        ms: Date.now() - started,
        stages,
      }),
    );

    const fallbackTitle = authorId ? `TikTok by @${authorId}` : "TikTok";
    return {
      title: caption ? titleFromText(caption, fallbackTitle) : transcript ? titleFromText(transcript.text, fallbackTitle) : fallbackTitle,
      // Transcript stays out of the description — see the YouTube extractor.
      description: transcript || frames ? undefined : caption,
      ...body,
      usedProxy: usedProxy || undefined,
      usedSupadata: transcript?.source === "supadata" || undefined,
      canonicalUrl,
      originalUrl,
      siteName: "TikTok",
      authorName,
      imageUrl: clean(oembed?.thumbnail_url) ?? page?.cover,
      sourceName: "TikTok",
      sourceDomain: "tiktok.com",
      contentType: isPhotoPost ? "image" : "video",
    };
  } catch {
    return undefined;
  } finally {
    await session.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Instagram
// ---------------------------------------------------------------------------

/** `/reel/SC`, `/reels/SC`, `/p/SC`, `/tv/SC`, and the same under a username
 * (`/{user}/reel/SC/`). `/share/…` links carry no shortcode until resolved. */
const INSTAGRAM_SHORTCODE_RE = /^\/(?!share\/)(?:[A-Za-z0-9_.]+\/)?(?:reels?|p|tv)\/([A-Za-z0-9_-]{5,})/;

type InstagramOembed = { title?: string; author_name?: string; thumbnail_url?: string };

type InstagramSlide = { displayUrl?: string; isVideo: boolean; videoUrl?: string; altText?: string };

type InstagramEmbed = {
  isVideo: boolean;
  videoUrl?: string;
  caption?: string;
  username?: string;
  displayUrl?: string;
  altText?: string;
  /** Carousel children, in order (empty for single-media posts). */
  slides: InstagramSlide[];
  viaProxy: boolean;
};

async function fetchInstagramOembed(postUrl: string, session: ProxySession): Promise<InstagramOembed | undefined> {
  const fetched = await fetchText(
    `https://i.instagram.com/api/v1/oembed/?url=${encodeURIComponent(postUrl)}`,
    { "user-agent": IPHONE_UA, accept: "application/json" },
    session,
    8000,
    (status, body) => status === 200 && body.includes('"author_name"'),
  );
  return fetched ? jsonOrUndefined<InstagramOembed>(fetched.body) : undefined;
}

function isEscapedAt(text: string, index: number): boolean {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i--) backslashes++;
  return backslashes % 2 === 1;
}

/** Index of the nearest unescaped double quote at or before/after `from`. */
function findQuote(text: string, from: number, direction: -1 | 1): number {
  for (let i = from; i >= 0 && i < text.length; i += direction) {
    if (text[i] === '"' && !isEscapedAt(text, i)) return i;
  }
  return -1;
}

/** The balanced `{…}` object starting at `start`, honouring JSON strings. */
function sliceBalancedObject(text: string, start: number): string | undefined {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return undefined;
}

/**
 * Pulls the `gql_data` object out of Instagram's embed page, where it sits as
 * JSON inside a JSON string inside a script's JSON string. Each pass peels one
 * string layer (the enclosing literal, found by the nearest unescaped quotes)
 * until `"gql_data":` appears as plain JSON, then brace-matches the object.
 */
export function extractInstagramGqlData(html: string): Record<string, unknown> | undefined {
  let text = html;
  for (let depth = 0; depth < 5; depth++) {
    const idx = text.indexOf("gql_data");
    if (idx < 0) return undefined;
    const quoted = text[idx - 1] === '"' && !isEscapedAt(text, idx - 1);
    if (quoted) {
      const colon = text.indexOf(":", idx);
      const brace = text.indexOf("{", colon);
      const object = brace >= 0 ? sliceBalancedObject(text, brace) : undefined;
      return object ? jsonOrUndefined<Record<string, unknown>>(object) : undefined;
    }
    const start = findQuote(text, idx, -1);
    const end = findQuote(text, idx, 1);
    if (start < 0 || end < 0) return undefined;
    const peeled = jsonOrUndefined<unknown>(text.slice(start, end + 1));
    if (typeof peeled !== "string") return undefined;
    text = peeled;
  }
  return undefined;
}

type GqlMedia = {
  is_video?: boolean;
  video_url?: string;
  display_url?: string;
  accessibility_caption?: string | null;
  owner?: { username?: string };
  edge_media_to_caption?: { edges?: { node?: { text?: string } }[] };
  edge_sidecar_to_children?: { edges?: { node?: GqlMedia }[] };
};

/** Instagram's alt text is generated ("May be an image of text that says
 * '…'") — only the ones that actually carry words are worth keeping. */
function usefulAltText(value: string | null | undefined): string | undefined {
  const text = clean(value);
  if (!text) return undefined;
  return /text that says|says '|"/i.test(text) || text.length > 60 ? text : undefined;
}

export function parseInstagramEmbed(html: string): Omit<InstagramEmbed, "viaProxy"> | undefined {
  const gql = extractInstagramGqlData(html);
  const media = gql?.shortcode_media as GqlMedia | undefined;
  if (media) {
    const slides: InstagramSlide[] = (media.edge_sidecar_to_children?.edges ?? [])
      .map((e) => e.node)
      .filter((n): n is GqlMedia => Boolean(n))
      .map((n) => ({
        displayUrl: clean(n.display_url),
        isVideo: Boolean(n.is_video),
        videoUrl: clean(n.video_url),
        altText: usefulAltText(n.accessibility_caption),
      }));
    return {
      isVideo: Boolean(media.is_video),
      videoUrl: clean(media.video_url),
      caption: clean(media.edge_media_to_caption?.edges?.[0]?.node?.text),
      username: clean(media.owner?.username),
      displayUrl: clean(media.display_url),
      altText: usefulAltText(media.accessibility_caption),
      slides,
    };
  }
  // No inlined JSON (older embed markup): the captioned variant still renders
  // the caption as HTML.
  const captionHtml = html.match(/<div class="Caption"[^>]*>([\s\S]*?)<div class="CaptionComments"/)?.[1];
  if (!captionHtml) return undefined;
  const username = clean(captionHtml.match(/class="CaptionUsername"[^>]*>([\s\S]*?)<\/a>/)?.[1]?.replace(/<[^>]+>/g, ""));
  const caption = clean(
    decodeEntities(captionHtml.replace(/<a class="CaptionUsername"[\s\S]*?<\/a>/, "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")).replace(/[ \t]+/g, " "),
  );
  const image = clean(html.match(/class="EmbeddedMediaImage"[^>]*src="([^"]+)"/)?.[1]);
  return caption ? { isVideo: html.includes("video_url"), caption, username, displayUrl: image, slides: [] } : undefined;
}

async function fetchInstagramEmbed(shortcode: string, session: ProxySession): Promise<InstagramEmbed | undefined> {
  const fetched = await fetchText(
    `https://www.instagram.com/p/${shortcode}/embed/captioned/`,
    { "user-agent": IPHONE_UA, accept: "text/html", "accept-language": "en-US,en;q=0.9" },
    session,
    12000,
    (status, body) => status === 200 && (body.includes("shortcode_media") || body.includes('class="Caption"')),
  );
  if (!fetched) return undefined;
  const parsed = parseInstagramEmbed(fetched.body);
  return parsed ? { ...parsed, viaProxy: fetched.viaProxy } : undefined;
}

export async function fetchInstagramMetadata(
  normalized: string,
  originalUrl: string,
  opts: SocialOpts,
): Promise<ExtractedMetadata | undefined> {
  const started = Date.now();
  const stages: Record<string, string> = {};
  const session = createProxySession();
  try {
    let shortcode = INSTAGRAM_SHORTCODE_RE.exec(new URL(normalized).pathname)?.[1];
    if (!shortcode && /^\/share\//.test(new URL(normalized).pathname)) {
      const resolved = await resolveRedirects(normalized, session);
      shortcode = INSTAGRAM_SHORTCODE_RE.exec(new URL(resolved).pathname)?.[1];
      stages.id = shortcode ? "resolved" : "miss";
    }
    // Profiles, stories and other non-post URLs fall through to the generic scrape.
    if (!shortcode) return undefined;

    const postUrl = `https://www.instagram.com/p/${shortcode}/`;
    const t0 = Date.now();
    const [oembed, embed] = await Promise.all([fetchInstagramOembed(postUrl, session), fetchInstagramEmbed(shortcode, session)]);
    stages.fetchMs = String(Date.now() - t0);
    stages.oembed = oembed?.title || oembed?.author_name ? "ok" : "miss";
    const kind = !embed ? "unknown" : embed.slides.length > 0 ? `carousel(${embed.slides.length})` : embed.isVideo ? (embed.videoUrl ? "video" : "video_no_url") : "photo";
    stages.embed = embed ? `${kind}${embed.viaProxy ? "/proxy" : ""}` : "miss";
    if (!oembed && !embed) return undefined;

    const caption = embed?.caption ?? clean(oembed?.title);
    const username = embed?.username ?? clean(oembed?.author_name);
    // Unknown media kind (embed missed) is treated as video so the paid
    // backstop still gets its chance — accuracy over a credit.
    const videoSlide = embed?.slides.find((s) => s.isVideo && s.videoUrl);
    const isVideo = embed ? embed.isVideo || Boolean(videoSlide) : true;
    const videoUrl = embed?.videoUrl ?? videoSlide?.videoUrl;
    const canonicalUrl = `https://www.instagram.com/${embed?.isVideo ? "reel" : "p"}/${shortcode}`;
    const altText = [embed?.altText, ...(embed?.slides.map((s) => s.altText) ?? [])].filter((t): t is string => Boolean(t));

    let transcript: Transcript | undefined;
    let speechless = false;
    if (videoUrl && asrConfigured()) {
      const t1 = Date.now();
      const asr = await transcribeMediaUrl({ url: videoUrl, session, headers: { "user-agent": IPHONE_UA }, filename: "video.mp4" });
      if ("failure" in asr) {
        speechless = asr.failure === "short_text";
        stages.asr = stageMs(`miss:${asr.failure}`, t1);
      } else {
        transcript = { text: asr.text, source: asr.provider, viaProxy: asr.viaProxy };
        stages.asr = stageMs(`${asr.provider}${asr.viaProxy ? "/proxy" : ""}`, t1);
      }
    }
    if (!transcript && isVideo && !speechless && opts.allowPaidTranscript) {
      const t1 = Date.now();
      const paid = await fetchSupadataTranscript(`https://www.instagram.com/reel/${shortcode}/`, "auto");
      if (paid) transcript = { text: paid, source: "supadata" };
      stages.supadata = stageMs(paid ? "ok" : "miss", t1);
    }

    // Photos, carousels, and speechless reels: read the slides / cover.
    let frames: { text: string; viaProxy: boolean } | undefined;
    if (!transcript) {
      const urls = embed?.slides.length ? embed.slides.map((s) => s.displayUrl ?? "") : [embed?.displayUrl ?? "", clean(oembed?.thumbnail_url) ?? ""];
      const t1 = Date.now();
      const read = await readFrames(urls, caption, session);
      if (read) frames = read;
      stages.vision = stageMs(read ? `ok(${read.frames})${read.viaProxy ? "/proxy" : ""}` : "miss", t1);
    }

    if (!caption && !transcript && !frames) return undefined;

    const body = composeBody({ transcript: transcript?.text, frames: frames?.text, caption, altText });
    const usedProxy = Boolean(embed?.viaProxy || transcript?.viaProxy || frames?.viaProxy);
    console.log(
      JSON.stringify({
        event: "social_extraction",
        host: "instagram.com",
        id: shortcode,
        kind,
        transcript: transcript?.source ?? null,
        bodySource: body.bodySource ?? null,
        usedProxy,
        ms: Date.now() - started,
        stages,
      }),
    );

    const noun = embed?.isVideo ? "reel" : "post";
    const fallbackTitle = username ? `Instagram ${noun} by @${username}` : `Instagram ${noun}`;
    return {
      title: caption ? titleFromText(caption, fallbackTitle) : fallbackTitle,
      description: transcript || frames ? undefined : caption,
      ...body,
      usedProxy: usedProxy || undefined,
      usedSupadata: transcript?.source === "supadata" || undefined,
      canonicalUrl,
      originalUrl,
      siteName: "Instagram",
      authorName: username,
      imageUrl: clean(oembed?.thumbnail_url) ?? embed?.displayUrl,
      sourceName: "Instagram",
      sourceDomain: "instagram.com",
      contentType: isVideo ? "video" : "image",
    };
  } catch {
    return undefined;
  } finally {
    await session.close().catch(() => {});
  }
}
