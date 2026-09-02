import { CaptureKind } from "@prisma/client";
import { providerFetch } from "@/server/connections/http";
import type { ProviderItem } from "@/server/connections/types";
import { resolveWork, type Resolved } from "@/server/imports/resolve";
import { capturePipeline } from "@/server/services/admission";
import { captureItem } from "@/server/services/cognition";
import { createManualContentItem } from "@/server/services/content";

/**
 * Onboarding recognition: the person names a work they already love ("Interstellar",
 * "The Left Hand of Darkness") and it becomes a real first capture — the same
 * words-about-a-work shape the connected-account sync produces, minus the feed.
 *
 * Understanding is a ladder, and a rung must never silently fail into a bare
 * title (a node mneme doesn't understand can't produce a reading worth having):
 *   1. the keyless catalogues (Wikipedia, Open Library, AniList, Steam)
 *   2. the model's own knowledge of the work (describeWork)
 *   3. the person themselves — the client asks for a line and it arrives as
 *      userContext, the pipeline's ground-truth fail-safe.
 *
 * The LLM calls live here rather than in cognition/llm.ts so this flow stays
 * self-contained; if a shared work-recall helper lands there later, these are
 * the lines to swap out.
 */

type Lookup = NonNullable<ProviderItem["lookup"]>;

/** resolver kind → ContentItem.contentType (inverse of capture-items' RESOLVE_KIND). */
const CONTENT_TYPE: Record<Lookup["kind"], string> = {
  film: "film",
  tv: "tv",
  book: "book",
  anime: "anime",
  game: "game",
  album: "music",
};

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const LLM_TIMEOUT_MS = 10_000;

async function completeJson(system: string, user: unknown, maxTokens: number): Promise<Record<string, unknown> | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  try {
    const response = await fetch(OPENAI_URL, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
        temperature: 0.2,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify(user) },
        ],
      }),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = payload.choices?.[0]?.message?.content;
    if (!raw) return null;
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Rung two: what the work is, from the model's own knowledge — for titles no
 * catalogue page carries (a translated title, a niche release, a mistyped
 * year). Description only; a work the model doesn't recognize returns null
 * rather than a hallucinated synopsis.
 */
export async function describeWork(lookup: Lookup): Promise<{ description: string; author: string | null } | null> {
  const system = [
    "You identify a creative work from its title and kind for a personal knowledge library.",
    "If you recognize the work with reasonable confidence, describe what it actually is and is about in 2–4 factual sentences (no marketing copy, no spoiler warnings), and give its author/director/creator if known.",
    "If you do not recognize it, or several works match and you cannot tell which, return nulls — never guess or invent.",
    'Return strictly valid JSON: {"description": "..." | null, "author": "..." | null}',
  ].join("\n");
  const parsed = await completeJson(system, { title: lookup.title, kind: lookup.kind, year: lookup.year ?? null, author: lookup.author ?? null }, 260);
  if (!parsed) return null;
  const description = typeof parsed.description === "string" && parsed.description.trim().length > 0 ? parsed.description.trim() : null;
  if (!description) return null;
  const author = typeof parsed.author === "string" && parsed.author.trim().length > 0 ? parsed.author.trim() : null;
  return { description, author };
}

/**
 * The probing questions: given a bare thought or quote, decide whether it
 * carries enough substance for a reading worth having. Strong material gets
 * an empty list; thin material ("love is real") gets one or two short
 * questions that draw out where it came from and what the person means.
 * Failures return [] — probing is an enrichment, never a gate.
 */
export async function probeCapture(args: { kind: "thought" | "quote"; text: string }): Promise<string[]> {
  const system = [
    `Someone is saving a ${args.kind} to their personal knowledge map. An AI reader will later write a short insight about it.`,
    "Judge ONLY whether the text carries enough substance to say something meaningful about — a specific claim, a source, a situation, a tension.",
    "If it does, return an empty list. Do not manufacture questions for material that stands on its own.",
    "If it is too thin or vague, return 1–2 short, conversational questions (max 12 words each) that would draw out the missing substance: where it came from, what prompted it, what the person actually means by it.",
    'Return strictly valid JSON: {"questions": ["..."]}',
  ].join("\n");
  const parsed = await completeJson(system, { text: args.text.slice(0, 2000) }, 120);
  if (!parsed || !Array.isArray(parsed.questions)) return [];
  return parsed.questions.filter((q): q is string => typeof q === "string" && q.trim().length > 0).map((q) => q.trim()).slice(0, 2);
}

/** Rungs one and two, shared by the preview route and the capture itself. */
export async function findWork(lookup: Lookup): Promise<{ resolved: Resolved | null; recalled: { description: string; author: string | null } | null }> {
  const resolved = await resolveWork(lookup);
  if (resolved?.description) return { resolved, recalled: null };
  const recalled = await describeWork(lookup);
  return { resolved, recalled };
}

// ── "maybe you meant" ──────────────────────────────────────────────────
// A short title often names several works ("Her" the Jonze film vs half a
// dozen others), and the resolver's one best guess can pick the wrong one.
// The preview therefore also carries a few sibling candidates from the same
// keyless sources; choosing one re-resolves with its exact title and year,
// so the commit stays consistent with the card the person confirmed.

export type WorkAlternative = { title: string; year?: number; hint?: string };

const WIKI_UA = "Mneme/1.0 (https://mneme-app.com; hello@mneme-app.com) recognize-alternatives";

const WIKI_TEMPLATE: Record<string, string> = {
  film: 'hastemplate:"Infobox film"',
  tv: 'hastemplate:"Infobox television"',
  album: 'hastemplate:"Infobox album"',
  book: 'hastemplate:"Infobox book"',
  game: 'hastemplate:"Infobox video game"',
  anime: 'hastemplate:"Infobox animanga/Header"',
};

async function wikipediaAlternatives(title: string, kind: string): Promise<WorkAlternative[]> {
  const params = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: `${title} ${WIKI_TEMPLATE[kind] ?? ""}`.trim(),
    gsrlimit: "5",
    prop: "description|pageprops",
    ppprop: "disambiguation",
    format: "json",
  });
  const res = await providerFetch(`https://en.wikipedia.org/w/api.php?${params}`, { providerName: "wikipedia", headers: { "user-agent": WIKI_UA } });
  if (!res.ok) return [];
  const data = (await res.json()) as { query?: { pages?: Record<string, { title: string; description?: string; pageprops?: { disambiguation?: string } }> } };
  return Object.values(data.query?.pages ?? {})
    // Presence check, not truthiness: the API marks disambiguation pages with
    // an EMPTY string, which is falsy.
    .filter((p) => p.pageprops?.disambiguation === undefined)
    .map((p) => ({ title: p.title, hint: p.description }));
}

async function openLibraryAlternatives(title: string, author?: string): Promise<WorkAlternative[]> {
  const params = new URLSearchParams({ title, limit: "4", fields: "title,author_name,first_publish_year" });
  if (author) params.set("author", author);
  const res = await providerFetch(`https://openlibrary.org/search.json?${params}`, { providerName: "open library", headers: { "user-agent": WIKI_UA } });
  if (!res.ok) return [];
  const data = (await res.json()) as { docs?: { title: string; author_name?: string[]; first_publish_year?: number }[] };
  return (data.docs ?? []).map((d) => ({ title: d.title, year: d.first_publish_year, hint: d.author_name?.[0] }));
}

async function anilistAlternatives(title: string): Promise<WorkAlternative[]> {
  const res = await providerFetch("https://graphql.anilist.co", {
    providerName: "anilist",
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      query: `query ($q: String) { Page(perPage: 4) { media(search: $q, type: ANIME) { startDate { year } format title { english romaji } } } }`,
      variables: { q: title },
    }),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { data?: { Page?: { media?: { startDate?: { year?: number }; format?: string; title: { english?: string | null; romaji?: string | null } }[] } } };
  return (data.data?.Page?.media ?? [])
    .map((m) => ({ title: m.title.english || m.title.romaji || "", year: m.startDate?.year, hint: m.format?.toLowerCase() }))
    .filter((a) => a.title.length > 0);
}

async function steamAlternatives(title: string): Promise<WorkAlternative[]> {
  const res = await providerFetch(`https://steamcommunity.com/actions/SearchApps/${encodeURIComponent(title)}`, { providerName: "steam" });
  if (!res.ok) return [];
  const apps = (await res.json()) as { name: string }[];
  return apps.slice(0, 4).map((a) => ({ title: a.name }));
}

const altKey = (a: WorkAlternative) => `${a.title.toLowerCase().trim()}|${a.year ?? ""}`;

/** Sibling candidates for the confirm card (the caller drops the shown pick). */
export async function findWorkAlternatives(lookup: Lookup): Promise<WorkAlternative[]> {
  let all: WorkAlternative[] = [];
  try {
    switch (lookup.kind) {
      case "book":
        all = await openLibraryAlternatives(lookup.title, lookup.author);
        break;
      case "anime":
        all = await anilistAlternatives(lookup.title);
        break;
      case "game":
        all = await steamAlternatives(lookup.title);
        break;
      default:
        all = await wikipediaAlternatives(lookup.title, lookup.kind);
    }
  } catch {
    return [];
  }
  const seen = new Set<string>();
  const out: WorkAlternative[] = [];
  for (const alt of all) {
    const key = altKey(alt);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(alt);
    if (out.length === 4) break;
  }
  return out;
}

export async function captureRecognizedWork(args: {
  userId: string;
  lookup: Lookup;
  words?: string;
  /** The person's own account of what the work is — rung three of the ladder. */
  context?: string;
}) {
  const { resolved, recalled } = await findWork(args.lookup);

  // The catalogue page's hostname, the way the Readwise sync names sources.
  let siteName: string | undefined;
  if (resolved?.url) {
    try {
      siteName = new URL(resolved.url).hostname.replace(/^www\./, "") || undefined;
    } catch {
      /* the title is enough */
    }
  }

  const content = await createManualContentItem({
    title: resolved?.title ?? args.lookup.title,
    description: resolved?.description ?? recalled?.description,
    canonicalUrl: resolved?.url,
    originalUrl: resolved?.url,
    siteName,
    imageUrl: resolved?.imageUrl,
    authorName: resolved?.author ?? recalled?.author ?? args.lookup.author,
    contentType: CONTENT_TYPE[args.lookup.kind],
    topics: [],
  });

  return capturePipeline.run(() =>
    captureItem({
      userId: args.userId,
      kind: CaptureKind.LINK,
      url: resolved?.url,
      contentItemId: content.id,
      origin: "onboarding",
      reaction: args.words || undefined,
      userContext: args.context || undefined,
    }),
  );
}
