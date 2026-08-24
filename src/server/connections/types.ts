import { AppError } from "@/lib/api";

/**
 * One entry from a connected account, normalised so the sync loop never has
 * to know which provider it came from. Only entries that carry the person's
 * own words become captures — see docs/design/2026-08-23-account-connections-design.md.
 */
export type ProviderItem = {
  /** The provider's stable id for this entry (review id, highlight ids). */
  externalId: string;
  /** "Face/Off (1997)", "The Long Ships". */
  title: string;
  /** The person's own entry page. Unique per person, so safe as a canonical URL. */
  url: string;
  /** What the person wrote: review text or highlight notes. Plain text. */
  words: string;
  /** Readwise only: the highlighted passages themselves. */
  quote?: string;
  /** Content context that is not the person's words (a book blurb). */
  description?: string;
  author?: string;
  imageUrl?: string;
  /** Display only, e.g. "★★★★½". Never fed to the pipeline. */
  rating?: string;
  /** When it was watched / read / highlighted. Clamped to now at capture time. */
  occurredAt: Date;
  /**
   * "words" (default): the capture is built from the feed — the person's own
   * text is the substance and nothing is scraped. "link": the entry is a
   * page the person chose to keep (a saved article, a playlisted video); it
   * runs through the ordinary link pipeline so the page's own content is
   * read, with `words` (if any) as the reaction. "text": the entry IS the
   * person's own writing (a post, a comment, a note) — a TEXT capture whose
   * substance is `words`, with `url` kept as its source.
   */
  mode?: "words" | "link" | "text";
  /**
   * Set when the source names a work but has no page for it (a Netflix
   * title, an IMDb rating). `url` is empty until the work resolver finds one.
   */
  lookup?: { kind: "film" | "tv" | "book" | "anime" | "game" | "album"; title: string; year?: number; author?: string };
};

export type ProviderFeed = {
  /** The account's own name for itself, shown on the connections screen. */
  label: string | null;
  items: ProviderItem[];
  /** Entries seen in the feed, including ones with no words. */
  seen: number;
  /** Provider-side cursor to store for next time, if the provider has one. */
  cursor?: string | null;
};

/**
 * A failure the person can act on. `code` is stable for the client and
 * analytics; `message` is the lowercase sentence the screen shows verbatim.
 */
export class ProviderError extends AppError {
  constructor(code: "NOT_FOUND" | "PRIVATE" | "BAD_TOKEN" | "UNAVAILABLE" | "INVALID_INPUT", message: string, status = 422) {
    super(code, message, status);
    this.name = "ProviderError";
  }
}

export type Provider = {
  /** Lower-case provider name, matching the enum and `CapturedItem.origin`. */
  key: string;
  /**
   * Turn whatever the person typed (username, profile URL, token) into the
   * stored handle + secret, checking with the provider that it exists. Throws
   * ProviderError with a sentence that says what to fix.
   */
  link(input: string): Promise<{ handle: string; secret?: string; label: string | null }>;
  /** Pull the feed. `cursor` is whatever the last sync stored. */
  fetch(args: { handle: string; secret: string | null; cursor: string | null }): Promise<ProviderFeed>;
  /**
   * Some sites turn datacenter IPs away but serve phones happily. When set,
   * the app fetches this URL itself (with these headers) and posts the body,
   * which `parse` turns into the feed.
   */
  deviceFeed?: (handle: string) => { url: string; headers?: Record<string, string> };
  parse?: (text: string) => ProviderFeed;
};

export const FETCH_TIMEOUT_MS = 15_000;
export const USER_AGENT = "Mneme/1.0 (+https://mneme-app.com)";
