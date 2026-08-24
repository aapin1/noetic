import { providerFetch } from "./http";
import { clampText, hasWords, parseDate } from "./text";
import { ProviderError, type Provider, type ProviderFeed, type ProviderItem } from "./types";

/**
 * Music, where words are rare. ListenBrainz pins carry a "blurb" the person
 * wrote about a track (public, no key); Bandcamp's collection carries the
 * "supported because…" line a fan leaves on a purchase (public, undocumented
 * POST). Listens and plays alone are activity and stay put. Verified live
 * 2026-08-23.
 */

const BLURB_MAX = 2000;
const CHROME_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

// ------------------------------------------------------------ listenbrainz

type LbPin = {
  row_id: number;
  blurb_content: string | null;
  created: number;
  recording_mbid: string | null;
  track_metadata: { artist_name: string; track_name: string; release_name?: string | null };
};

export function parseListenbrainzUser(input: string): string | null {
  let s = input.trim().replace(/^@/, "");
  const m = s.match(/listenbrainz\.org\/user\/([^/?#\s]+)/i);
  if (m) s = m[1];
  return /^[A-Za-z0-9_.-]{1,64}$/.test(s) ? s : null;
}

export function listenbrainzItems(pins: LbPin[]): ProviderItem[] {
  const items: ProviderItem[] = [];
  for (const p of pins) {
    const words = clampText((p.blurb_content ?? "").trim(), BLURB_MAX);
    if (!hasWords(words)) continue;
    const title = `${p.track_metadata.track_name} — ${p.track_metadata.artist_name}`;
    items.push({
      externalId: `lb-pin-${p.row_id}`,
      title,
      url: p.recording_mbid ? `https://musicbrainz.org/recording/${p.recording_mbid}` : `https://listenbrainz.org/pin/${p.row_id}`,
      words,
      occurredAt: new Date(p.created * 1000),
    });
  }
  return items;
}

export const listenbrainz: Provider = {
  key: "listenbrainz",
  async link(input) {
    const user = parseListenbrainzUser(input);
    if (!user) throw new ProviderError("INVALID_INPUT", "that doesn't look like a listenbrainz username");
    const res = await providerFetch(`https://api.listenbrainz.org/1/${encodeURIComponent(user)}/pins?count=1`, { providerName: "listenbrainz" });
    if (res.status === 404) throw new ProviderError("NOT_FOUND", `couldn't find "${user}" on listenbrainz — check the spelling`);
    if (!res.ok) throw new ProviderError("UNAVAILABLE", "listenbrainz isn't answering right now — try again in a bit", 503);
    return { handle: user, label: user };
  },
  async fetch({ handle }) {
    const res = await providerFetch(`https://api.listenbrainz.org/1/${encodeURIComponent(handle)}/pins?count=100`, { providerName: "listenbrainz" });
    if (res.status === 404) throw new ProviderError("NOT_FOUND", "that listenbrainz account is gone");
    if (!res.ok) throw new ProviderError("UNAVAILABLE", "listenbrainz isn't answering right now — try again in a bit", 503);
    const data = (await res.json()) as { pinned_recordings: LbPin[] };
    return { label: null, items: listenbrainzItems(data.pinned_recordings), seen: data.pinned_recordings.length };
  },
};

// ---------------------------------------------------------------- bandcamp

type BcItem = {
  item_id: number;
  item_title: string;
  band_name: string;
  item_url: string;
  purchased: string | null;
  why: string | null;
  item_art_url?: string | null;
  is_private?: boolean;
};

export function parseBandcampFan(input: string): string | null {
  let s = input.trim().replace(/^@/, "");
  const m = s.match(/bandcamp\.com\/([A-Za-z0-9_-]+)\/?$/i);
  if (m) s = m[1];
  return /^[A-Za-z0-9_-]{1,64}$/.test(s) ? s.toLowerCase() : null;
}

/** Every purchase is a kept page; a "supported because" line is the person's words. */
export function bandcampItems(rows: BcItem[]): ProviderItem[] {
  return rows
    .filter((r) => !r.is_private && /^https?:\/\//i.test(r.item_url))
    .map((r) => {
      const why = clampText((r.why ?? "").trim(), BLURB_MAX);
      return {
        externalId: `bc-${r.item_id}`,
        title: `${r.item_title} — ${r.band_name}`,
        url: r.item_url,
        words: hasWords(why) ? why : "",
        imageUrl: r.item_art_url ?? undefined,
        occurredAt: parseDate(r.purchased) ?? new Date(),
        mode: "link" as const,
      };
    });
}

async function fanId(fan: string): Promise<{ id: number; name: string }> {
  const res = await providerFetch(`https://bandcamp.com/${encodeURIComponent(fan)}`, { providerName: "bandcamp", headers: { "user-agent": CHROME_UA } });
  if (res.status === 404) throw new ProviderError("NOT_FOUND", `couldn't find a bandcamp fan called "${fan}" — check the spelling`);
  if (!res.ok) throw new ProviderError("UNAVAILABLE", "bandcamp isn't answering right now — try again in a bit", 503);
  const html = (await res.text()).replace(/&quot;/g, '"');
  const id = html.match(/"fan_id":(\d+)/)?.[1];
  const name = html.match(/"fan_data":\{[^}]*?"name":"([^"]*)"/)?.[1];
  if (!id) throw new ProviderError("NOT_FOUND", `couldn't read "${fan}"'s bandcamp collection — is the profile public?`);
  return { id: Number(id), name: name ?? fan };
}

export const bandcamp: Provider = {
  key: "bandcamp",
  async link(input) {
    const fan = parseBandcampFan(input);
    if (!fan) throw new ProviderError("INVALID_INPUT", "paste your bandcamp fan page link — bandcamp.com/you");
    const { id, name } = await fanId(fan);
    return { handle: String(id), label: name };
  },
  async fetch({ handle }) {
    const rows: BcItem[] = [];
    let token = "9999999999:9999999999:a::";
    for (let page = 0; page < 3; page += 1) {
      const res = await providerFetch("https://bandcamp.com/api/fancollection/1/collection_items", {
        providerName: "bandcamp",
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": CHROME_UA },
        body: JSON.stringify({ fan_id: Number(handle), older_than_token: token, count: 100 }),
      });
      if (!res.ok) throw new ProviderError("UNAVAILABLE", "bandcamp isn't answering right now — try again in a bit", 503);
      const data = (await res.json()) as { items: BcItem[]; more_available: boolean; last_token: string };
      rows.push(...data.items);
      if (!data.more_available || !data.last_token) break;
      token = data.last_token;
    }
    return { label: null, items: bandcampItems(rows), seen: rows.length };
  },
};
