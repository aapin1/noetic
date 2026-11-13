import type { ContentConfidence } from "@/server/metadata";

export type BlockReason = "paywall" | "login_wall" | "partial_post" | "unavailable" | "unreadable_article";

/** Why a source couldn't be read, phrased for the capture sheet's context box. */
export type BlockedSource = { reason: BlockReason; message: string };

/**
 * Hard-paywalled publishers. Most declare `isAccessibleForFree: false` in
 * JSON-LD (Google's paywall markup) and are caught by that flag; this list
 * covers the ones that don't, and rows captured before the flag existed.
 */
const PAYWALL_DOMAINS = [
  "nytimes.com",
  "wsj.com",
  "ft.com",
  "economist.com",
  "washingtonpost.com",
  "bloomberg.com",
  "theatlantic.com",
  "newyorker.com",
  "wired.com",
  "telegraph.co.uk",
  "thetimes.co.uk",
  "thetimes.com",
  "bostonglobe.com",
  "latimes.com",
  "businessinsider.com",
  "hbr.org",
  "foreignaffairs.com",
  "theinformation.com",
  "barrons.com",
  "scientificamerican.com",
  "newscientist.com",
  "technologyreview.com",
  "nymag.com",
  "vanityfair.com",
  "spectator.co.uk",
  "lemonde.fr",
  "haaretz.com",
];

const SCREENSHOT = "Screenshot it and Mneme will read it, or tell Mneme what it's about.";

function hostMatches(host: string, domains: string[]) {
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

/**
 * Names the specific wall a thin read hit, so the capture sheet can say
 * "Facebook keeps posts behind a login" instead of a generic "couldn't read
 * this". Returns undefined for a clean read, or when the cause is unknown
 * (the sheet keeps its generic line).
 */
export function diagnoseBlockedSource(args: {
  url: string;
  confidence: ContentConfidence;
  contentType?: string | null;
  paywalled?: boolean;
}): BlockedSource | undefined {
  if (args.confidence === "rich") return undefined;

  let host: string;
  try {
    host = new URL(args.url).hostname.toLowerCase().replace(/^(www|m|mobile)\./, "");
  } catch {
    return undefined;
  }

  if (hostMatches(host, ["facebook.com", "fb.watch", "fb.com"])) {
    return { reason: "login_wall", message: `Facebook keeps posts behind a login, so we couldn't read this one. ${SCREENSHOT}` };
  }
  if (hostMatches(host, ["linkedin.com", "lnkd.in"])) {
    return { reason: "login_wall", message: `LinkedIn hides posts from apps that aren't logged in. ${SCREENSHOT}` };
  }
  if (hostMatches(host, ["threads.net", "threads.com"])) {
    return { reason: "login_wall", message: `Threads didn't let us read this post. ${SCREENSHOT}` };
  }
  if (hostMatches(host, ["instagram.com", "instagr.am"])) {
    return { reason: "unavailable", message: `We couldn't read this Instagram post. It may be private or removed. ${SCREENSHOT}` };
  }
  if (hostMatches(host, ["tiktok.com"])) {
    return { reason: "unavailable", message: `We couldn't read this TikTok. It may be private or removed. ${SCREENSHOT}` };
  }
  if (hostMatches(host, ["x.com", "twitter.com"])) {
    return { reason: "partial_post", message: `X only shares part of a post with apps. ${SCREENSHOT}` };
  }
  if (args.paywalled || hostMatches(host, PAYWALL_DOMAINS)) {
    return {
      reason: "paywall",
      message: "This article is behind a paywall, so we could only see the headline. Screenshot the opening paragraphs and Mneme will read them, or tell Mneme what it's about.",
    };
  }
  if (args.contentType === "article") {
    return {
      reason: "unreadable_article",
      message: "We couldn't get past this article's page. It may be paywalled or blocking apps. Screenshot the opening paragraphs and Mneme will read them, or tell Mneme what it's about.",
    };
  }
  return undefined;
}
