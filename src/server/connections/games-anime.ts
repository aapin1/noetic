import { load } from "cheerio";
import { providerFetch } from "./http";
import { clampText, hasWords, htmlToText, parseDate, starsFromRating } from "./text";
import { ProviderError, type Provider, type ProviderFeed, type ProviderItem } from "./types";

/**
 * Kitsu (anime/manga notes + reviews, public JSON:API), Steam (the person's
 * written game reviews, public HTML), Backloggd (reviews, public HTML), RAWG
 * (reviews, public JSON). Ratings and playtime alone are activity and stay
 * put. Verified live 2026-08-23; the two HTML ones are the most brittle.
 */

const NOTE_MAX = 4000;
const REVIEW_MAX = 6000;

// -------------------------------------------------------------------- kitsu

const KITSU = "https://kitsu.app/api/edge";
const KITSU_HEADERS = { accept: "application/vnd.api+json" };

type KitsuEntry = {
  id: string;
  attributes: { status: string; notes: string | null; ratingTwenty: number | null; finishedAt: string | null; updatedAt: string };
  relationships: { anime?: { data: { id: string } | null }; manga?: { data: { id: string } | null } };
};
type KitsuMedia = { id: string; type: string; attributes: { canonicalTitle: string; slug: string; synopsis: string | null; posterImage?: { large?: string } | null } };
type KitsuReview = { id: string; attributes: { content: string; rating: number | null; createdAt: string }; relationships: { media: { data: { id: string; type: string } | null } } };

export function parseKitsuHandle(input: string): string | null {
  let s = input.trim().replace(/^@/, "");
  const m = s.match(/kitsu\.(?:app|io)\/users\/([^/?#\s]+)/i);
  if (m) s = m[1];
  return /^[A-Za-z0-9_-]{2,40}$/.test(s) ? s : null;
}

async function kitsuJson<T>(path: string): Promise<T> {
  const res = await providerFetch(`${KITSU}${path}`, { providerName: "kitsu", headers: KITSU_HEADERS });
  if (res.status === 429) throw new ProviderError("UNAVAILABLE", "kitsu is rate-limiting us — it'll catch up on the next pass", 503);
  if (!res.ok) throw new ProviderError("UNAVAILABLE", "kitsu isn't answering right now — try again in a bit", 503);
  return (await res.json()) as T;
}

export function kitsuItems(entries: KitsuEntry[], included: KitsuMedia[], reviews: KitsuReview[]): ProviderItem[] {
  const media = new Map(included.map((m) => [`${m.type}:${m.id}`, m]));
  const items: ProviderItem[] = [];
  for (const e of entries) {
    const words = clampText((e.attributes.notes ?? "").trim(), NOTE_MAX);
    if (!hasWords(words)) continue;
    const ref = e.relationships.anime?.data ? { type: "anime", id: e.relationships.anime.data.id } : e.relationships.manga?.data ? { type: "manga", id: e.relationships.manga.data.id } : null;
    const m = ref ? media.get(`${ref.type}:${ref.id}`) : undefined;
    if (!m) continue;
    const score = e.attributes.ratingTwenty ? `${Math.round(e.attributes.ratingTwenty / 2) / 1}/10` : null;
    items.push({
      externalId: `kitsu-entry-${e.id}`,
      title: m.attributes.canonicalTitle,
      url: `https://kitsu.app/${m.type}/${m.attributes.slug}`,
      words,
      description: clampText((m.attributes.synopsis ?? "").trim(), 1200) || undefined,
      imageUrl: m.attributes.posterImage?.large ?? undefined,
      rating: [score, `${e.attributes.status} ${m.type}`].filter(Boolean).join(" · "),
      occurredAt: parseDate(e.attributes.finishedAt) ?? parseDate(e.attributes.updatedAt) ?? new Date(),
    });
  }
  for (const r of reviews) {
    const words = clampText(htmlToText(r.attributes.content), REVIEW_MAX);
    if (!hasWords(words) || !r.relationships.media.data) continue;
    const m = media.get(`${r.relationships.media.data.type}:${r.relationships.media.data.id}`);
    if (!m) continue;
    items.push({
      externalId: `kitsu-review-${r.id}`,
      title: m.attributes.canonicalTitle,
      url: `https://kitsu.app/${m.type}/${m.attributes.slug}/reviews/${r.id}`,
      words,
      description: clampText((m.attributes.synopsis ?? "").trim(), 1200) || undefined,
      imageUrl: m.attributes.posterImage?.large ?? undefined,
      rating: r.attributes.rating ? `${Math.round(r.attributes.rating / 2)}/10 · review` : "review",
      occurredAt: parseDate(r.attributes.createdAt) ?? new Date(),
    });
  }
  return items;
}

export const kitsu: Provider = {
  key: "kitsu",
  async link(input) {
    const name = parseKitsuHandle(input);
    if (!name) throw new ProviderError("INVALID_INPUT", "that doesn't look like a kitsu username");
    const data = await kitsuJson<{ data: { id: string; attributes: { name: string } }[] }>(`/users?filter[name]=${encodeURIComponent(name)}`);
    const user = data.data.find((u) => u.attributes.name.toLowerCase() === name.toLowerCase()) ?? data.data[0];
    if (!user) throw new ProviderError("NOT_FOUND", `couldn't find "${name}" on kitsu — check the spelling`);
    return { handle: user.id, label: user.attributes.name };
  },
  async fetch({ handle }) {
    const included: KitsuMedia[] = [];
    const entries: KitsuEntry[] = [];
    for (const kind of ["anime", "manga"] as const) {
      const page = await kitsuJson<{ data: KitsuEntry[]; included?: KitsuMedia[] }>(
        `/library-entries?filter[userId]=${handle}&filter[kind]=${kind}&include=${kind}&fields[${kind}]=canonicalTitle,slug,synopsis,posterImage&page[limit]=500&sort=-updatedAt`,
      );
      entries.push(...page.data);
      included.push(...(page.included ?? []));
    }
    const reviews = await kitsuJson<{ data: KitsuReview[]; included?: KitsuMedia[] }>(
      `/reviews?filter[userId]=${handle}&include=media&fields[anime]=canonicalTitle,slug,synopsis,posterImage&fields[manga]=canonicalTitle,slug,synopsis,posterImage&page[limit]=20`,
    );
    included.push(...(reviews.included ?? []));
    return { label: null, items: kitsuItems(entries, included, reviews.data), seen: entries.length + reviews.data.length };
  },
};

// -------------------------------------------------------------------- steam

const CHROME_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

export function parseSteamInput(input: string): { path: string } | null {
  const s = input.trim();
  const m = s.match(/steamcommunity\.com\/(id|profiles)\/([^/?#\s]+)/i);
  if (m) return { path: `${m[1].toLowerCase()}/${m[2]}` };
  if (/^\d{17}$/.test(s)) return { path: `profiles/${s}` };
  if (/^[A-Za-z0-9_-]{2,32}$/.test(s)) return { path: `id/${s}` };
  return null;
}

/** Pure; exported for tests. The review page HTML is public; the game name is not in it (see `nameApps`). */
export function parseSteamReviews(html: string, path: string): ProviderFeed {
  const $ = load(html);
  const label = $(".profile_small_header_name a, .persona_name .actual_persona_name").first().text().trim() || null;
  const items: ProviderItem[] = [];
  $(".review_box").each((_, el) => {
    const box = $(el);
    const appId = box.find("a[href*='/app/']").first().attr("href")?.match(/\/app\/(\d+)/)?.[1];
    const words = clampText(htmlToText(box.find(".content").first().html() ?? ""), REVIEW_MAX);
    if (!appId || !hasWords(words)) return;
    const verdict = box.find(".title").first().text().trim();
    const hours = box.find(".hours").first().text().replace(/\s+/g, " ").replace(/\(.*\)/, "").trim();
    const posted = box.find(".posted").first().text().replace(/^Posted:?\s*/i, "").replace(/\.\s*$/, "").trim();
    items.push({
      externalId: `steam-${appId}`,
      title: `steam app ${appId}`,
      url: `https://steamcommunity.com/${path}/recommended/${appId}/`,
      words,
      imageUrl: box.find(".game_capsule").first().attr("src") ?? undefined,
      rating: [verdict || null, hours || null].filter(Boolean).join(" · ") || undefined,
      occurredAt: parseDate(posted.replace(/\s*@.*$/, "").replace(/^(\d+ \w+)$/, `$1, ${new Date().getFullYear()}`)) ?? new Date(),
    });
  });
  return { label, items, seen: $(".review_box").length };
}

/** Fill in game names from the keyless store endpoint, one call per app. */
async function nameApps(items: ProviderItem[]): Promise<void> {
  for (const item of items) {
    const appId = item.externalId.replace("steam-", "");
    try {
      const res = await providerFetch(`https://store.steampowered.com/api/appdetails?appids=${appId}&filters=basic`, { providerName: "steam" });
      if (!res.ok) continue;
      const data = (await res.json()) as Record<string, { success: boolean; data?: { name?: string; short_description?: string; header_image?: string } }>;
      const app = data[appId]?.data;
      if (app?.name) item.title = app.name;
      if (app?.short_description) item.description = clampText(htmlToText(app.short_description), 600);
      if (app?.header_image) item.imageUrl = app.header_image;
    } catch {
      /* keep the placeholder title */
    }
  }
}

export const steam: Provider = {
  key: "steam",
  async link(input) {
    const parsed = parseSteamInput(input);
    if (!parsed) throw new ProviderError("INVALID_INPUT", "paste your steam profile link, or the name from steamcommunity.com/id/…");
    const res = await providerFetch(`https://steamcommunity.com/${parsed.path}/recommended/`, { providerName: "steam", headers: { "user-agent": CHROME_UA } });
    if (res.status === 404) throw new ProviderError("NOT_FOUND", "couldn't find that steam profile — check the link");
    if (!res.ok) throw new ProviderError("UNAVAILABLE", "steam isn't answering right now — try again in a bit", 503);
    const html = await res.text();
    if (/profile_private_info|This profile is private/i.test(html)) {
      throw new ProviderError("PRIVATE", "that steam profile is private — set it to public in steam privacy settings, then try again");
    }
    if (/<title>Steam Community :: Error<\/title>/i.test(html)) throw new ProviderError("NOT_FOUND", "couldn't find that steam profile — check the link");
    return { handle: parsed.path, label: parseSteamReviews(html, parsed.path).label };
  },
  async fetch({ handle }) {
    const feed: ProviderFeed = { label: null, items: [], seen: 0 };
    for (let page = 1; page <= 3; page += 1) {
      const res = await providerFetch(`https://steamcommunity.com/${handle}/recommended/?p=${page}`, { providerName: "steam", headers: { "user-agent": CHROME_UA } });
      if (!res.ok) throw new ProviderError("UNAVAILABLE", "steam isn't answering right now — try again in a bit", 503);
      const part = parseSteamReviews(await res.text(), handle);
      feed.label = feed.label ?? part.label;
      feed.items.push(...part.items);
      feed.seen += part.seen;
      if (part.seen < 10) break;
    }
    await nameApps(feed.items);
    return feed;
  },
};

// ---------------------------------------------------------------- backloggd

export function parseBackloggdUser(input: string): string | null {
  let s = input.trim().replace(/^@/, "");
  const m = s.match(/backloggd\.com\/u\/([^/?#\s]+)/i);
  if (m) s = m[1];
  return /^[A-Za-z0-9_-]{2,32}$/.test(s) ? s : null;
}

/** Pure; exported for tests. Each review sits in a `.user-reviews` row: game name first, then the card. */
export function parseBackloggdReviews(html: string, user: string): ProviderFeed {
  const $ = load(html);
  const items: ProviderItem[] = [];
  let seen = 0;
  $(".user-reviews").each((_, el) => {
    const row = $(el);
    const card = row.find(".review-card").first();
    if (card.length === 0) return;
    seen += 1;
    const gameLink = row.find(".game-name a").first();
    const gameSlug = gameLink.attr("href")?.match(/\/games\/([^/?#]+)/)?.[1];
    const words = clampText(htmlToText(card.find(".review-body").first().html() ?? ""), REVIEW_MAX);
    if (!gameSlug || !hasWords(words)) return;
    const year = row.find(".game-date").first().text().trim();
    const name = gameLink.text().trim() || gameSlug;
    const reviewHref = card.find("a[href*='/review/']").first().attr("href")?.replace(/[#?].*$/, "").replace(/\/(likes)\/?$/, "");
    const reviewId = reviewHref?.match(/\/review\/(\d+)/)?.[1];
    const starsWidth = card.find(".stars-top").first().attr("style")?.match(/width:\s*([\d.]+)%/)?.[1];
    const stars = starsWidth ? starsFromRating(Number(starsWidth) / 20) : null;
    const status = card.find(".game-status").first().text().replace(/\s+/g, " ").trim();
    items.push({
      externalId: `bl-${reviewId ?? gameSlug}`,
      title: year ? `${name} (${year})` : name,
      url: reviewId ? `https://backloggd.com/u/${user}/review/${reviewId}/` : `https://backloggd.com/games/${gameSlug}/`,
      words,
      imageUrl: row.find(".game-cover img").first().attr("src") ?? undefined,
      rating: [stars, status || null].filter(Boolean).join(" · ") || undefined,
      occurredAt: parseDate(card.find("time").first().attr("datetime")) ?? new Date(),
    });
  });
  return { label: null, items, seen };
}

export const backloggd: Provider = {
  key: "backloggd",
  async link(input) {
    const user = parseBackloggdUser(input);
    if (!user) throw new ProviderError("INVALID_INPUT", "that doesn't look like a backloggd username");
    const res = await providerFetch(`https://backloggd.com/u/${user}/reviews/`, { providerName: "backloggd", headers: { "user-agent": CHROME_UA } });
    if (res.status === 404) throw new ProviderError("NOT_FOUND", `couldn't find "${user}" on backloggd — check the spelling`);
    if (!res.ok) throw new ProviderError("UNAVAILABLE", "backloggd isn't answering right now — try again in a bit", 503);
    return { handle: user, label: user };
  },
  async fetch({ handle }) {
    const feed: ProviderFeed = { label: null, items: [], seen: 0 };
    for (let page = 1; page <= 3; page += 1) {
      const res = await providerFetch(`https://backloggd.com/u/${handle}/reviews/?page=${page}`, { providerName: "backloggd", headers: { "user-agent": CHROME_UA } });
      if (!res.ok) throw new ProviderError("UNAVAILABLE", "backloggd isn't answering right now — try again in a bit", 503);
      const part = parseBackloggdReviews(await res.text(), handle);
      feed.items.push(...part.items);
      feed.seen += part.seen;
      if (part.seen === 0) break;
    }
    return feed;
  },
};

// --------------------------------------------------------------------- rawg

type RawgReview = { id: number; text: string; rating: number; created: string; game: { name: string; slug: string; background_image?: string | null } | null };

export function parseRawgUser(input: string): string | null {
  let s = input.trim().replace(/^@/, "");
  const m = s.match(/rawg\.io\/@([^/?#\s]+)/i);
  if (m) s = m[1];
  return /^[A-Za-z0-9_-]{2,40}$/.test(s) ? s : null;
}

export const rawg: Provider = {
  key: "rawg",
  async link(input) {
    const user = parseRawgUser(input);
    if (!user) throw new ProviderError("INVALID_INPUT", "that doesn't look like a rawg username — try rawg.io/@you");
    const res = await providerFetch(`https://api.rawg.io/api/users/${encodeURIComponent(user)}`, { providerName: "rawg" });
    if (res.status === 404) throw new ProviderError("NOT_FOUND", `couldn't find "${user}" on rawg — check the spelling`);
    if (!res.ok) throw new ProviderError("UNAVAILABLE", "rawg isn't answering right now — try again in a bit", 503);
    const profile = (await res.json()) as { slug: string; full_name?: string; username?: string };
    return { handle: profile.slug, label: profile.full_name || profile.username || profile.slug };
  },
  async fetch({ handle }) {
    const res = await providerFetch(`https://api.rawg.io/api/users/${encodeURIComponent(handle)}/reviews?page_size=100`, { providerName: "rawg" });
    if (res.status === 404) throw new ProviderError("NOT_FOUND", "that rawg account is gone");
    if (!res.ok) throw new ProviderError("UNAVAILABLE", "rawg isn't answering right now — try again in a bit", 503);
    const data = (await res.json()) as { results: RawgReview[] };
    const items: ProviderItem[] = [];
    for (const r of data.results) {
      const words = clampText(htmlToText(r.text), REVIEW_MAX);
      if (!hasWords(words) || !r.game) continue;
      items.push({
        externalId: `rawg-${r.id}`,
        title: r.game.name,
        url: `https://rawg.io/games/${r.game.slug}`,
        words,
        imageUrl: r.game.background_image ?? undefined,
        rating: r.rating ? `${r.rating}/5` : undefined,
        occurredAt: parseDate(r.created) ?? new Date(),
      });
    }
    return { label: null, items, seen: data.results.length };
  },
};
