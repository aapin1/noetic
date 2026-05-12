import { load } from "cheerio";
import slugify from "slugify";
import { normalizeUrl } from "@/server/url";

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
};

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

  return {
    title,
    description,
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

export async function fetchMetadata(url: string): Promise<{ metadata?: ExtractedMetadata; requiresManualInput: boolean }> {
  const normalized = normalizeUrl(url);
  const parsed = new URL(normalized);

  if (parsed.hostname.includes("youtube.com") || parsed.hostname === "youtu.be") {
    const oembedResponse = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(normalized)}&format=json`);

    if (oembedResponse.ok) {
      const payload = (await oembedResponse.json()) as {
        title?: string;
        author_name?: string;
        thumbnail_url?: string;
        provider_name?: string;
      };

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
      };

      return {
        metadata,
        requiresManualInput: !metadata.title,
      };
    }
  }

  const response = await fetch(normalized, {
    headers: {
      "user-agent": "MNEME/1.0 (+https://mneme.app)",
      accept: "text/html,application/xhtml+xml",
    },
  });

  if (!response.ok) {
    return { requiresManualInput: true };
  }

  const html = await response.text();
  const metadata = parseMetadataFromHtml(html, normalized);
  const requiresManualInput = !metadata.title || !metadata.canonicalUrl;

  return {
    metadata,
    requiresManualInput,
  };
}

export function sourceSlug(name: string) {
  return slugify(name, { lower: true, strict: true, trim: true });
}
