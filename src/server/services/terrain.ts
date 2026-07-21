import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/server/db";
import { isGeneralTopic } from "@/server/cognition/generalTopics";
import { generateTerrainNarrative } from "@/server/cognition/llm";

/** Below this, "terrain" stays locked — the era split needs real history to mean anything. */
export const TERRAIN_MIN_CAPTURES = 50;
/** At/above this the eras tighten to the outer quarters so the contrast sharpens. */
const TERRAIN_TIGHTEN_AT = 100;
/**
 * The cache is versioned by this bucket, so the payload (and its single LLM call)
 * regenerates about once per 25 new captures — not per view, not per capture.
 */
const CACHE_BUCKET = 25;
/** Bumped when the payload shape changes so stale-shaped caches regenerate. */
const TERRAIN_SCHEMA = 2;
/** Below this many embedded captures per era, the semantic chapters are omitted. */
const MIN_EMBEDDED_PER_ERA = 8;

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const DAY_MS = 86_400_000;

export interface TerrainField {
  name: string;
  /** Share of this era's field mentions, 0–1. */
  share: number;
}

export interface TerrainBridge {
  a: string;
  b: string;
}

export interface TerrainCount {
  name: string;
  count: number;
}

export interface TerrainResponse {
  unlocked: boolean;
  captureCount: number;
  eraSize: number;
  earlyLabel: string;
  recentLabel: string;

  /** Semantic drift of the capture-embedding centroid, early era → recent era. */
  driftDegrees: number | null;
  driftBand: "settled" | "a subtle drift" | "a real turn" | "a decisive shift" | null;
  towardField: string | null;
  awayField: string | null;

  /** Embedding dispersion per era (a unitless "spread index"); higher = more scattered. */
  earlySpread: number | null;
  recentSpread: number | null;
  spreadVerdict: "widening" | "deepening" | "steady" | null;
  /** Signed % change in dispersion, recent vs early. +30 = 30% more scattered. */
  spreadDeltaPct: number | null;
  /** Distinct specific topics touched in each era — a concrete breadth measure. */
  earlyDistinctTopics: number;
  recentDistinctTopics: number;

  earlyFields: TerrainField[];
  recentFields: TerrainField[];
  enduring: string[];
  emerged: string[];
  faded: string[];

  /** What/who you consume, across the whole history — most-frequent first. */
  topSources: TerrainCount[];
  topVoices: TerrainCount[];

  bridges: TerrainBridge[];
  bridgeCount: number;

  positionsStaked: number;
  positionsChallenged: number;
  positionsRevised: number;

  /** Cached 2–3 sentence reflective synthesis. Null when the LLM is unavailable. */
  arc: string | null;
}

const LOCKED = (captureCount: number): TerrainResponse => ({
  unlocked: false,
  captureCount,
  eraSize: 0,
  earlyLabel: "",
  recentLabel: "",
  driftDegrees: null,
  driftBand: null,
  towardField: null,
  awayField: null,
  earlySpread: null,
  recentSpread: null,
  spreadVerdict: null,
  spreadDeltaPct: null,
  earlyDistinctTopics: 0,
  recentDistinctTopics: 0,
  earlyFields: [],
  recentFields: [],
  enduring: [],
  emerged: [],
  faded: [],
  topSources: [],
  topVoices: [],
  bridges: [],
  bridgeCount: 0,
  positionsStaked: 0,
  positionsChallenged: 0,
  positionsRevised: 0,
  arc: null,
});

// ── vector helpers ──────────────────────────────────────────────────────────

function dot(a: number[], b: number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) s += a[i] * b[i];
  return s;
}

function norm(a: number[]): number {
  return Math.sqrt(dot(a, a));
}

function cosSim(a: number[], b: number[]): number {
  const na = norm(a);
  const nb = norm(b);
  if (na === 0 || nb === 0) return 0;
  return Math.max(-1, Math.min(1, dot(a, b) / (na * nb)));
}

function sub(a: number[], b: number[]): number[] {
  const n = Math.min(a.length, b.length);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i += 1) out[i] = a[i] - b[i];
  return out;
}

/**
 * A running centroid: sums vectors as they arrive instead of holding them all.
 *
 * Terrain's every use of the embeddings is an aggregate — era centroids, field
 * centroids, dispersions — so nothing here ever needs the full set resident.
 * That matters because this runs over a user's ENTIRE history: at 3,000 captures
 * the vectors alone are ~37MB, which on a small instance is an out-of-memory
 * crash rather than a slow request.
 *
 * Divides by every vector offered (matching the previous `centroid` over a
 * length-filtered array) while summing only dimension-matched ones.
 */
class RunningCentroid {
  private sum: number[] | null = null;
  /** Σ v/|v| — see `dispersionAbout`. */
  private unitSum: number[] | null = null;
  private offered = 0;

  add(vector: number[]) {
    if (vector.length === 0) return;
    this.offered += 1;
    if (!this.sum) {
      this.sum = new Array<number>(vector.length).fill(0);
      this.unitSum = new Array<number>(vector.length).fill(0);
    }
    if (vector.length !== this.sum.length) return;

    const magnitude = norm(vector);
    for (let i = 0; i < vector.length; i += 1) {
      this.sum[i] += vector[i];
      if (magnitude > 0) this.unitSum![i] += vector[i] / magnitude;
    }
  }

  get count() {
    return this.offered;
  }

  mean(): number[] | null {
    if (!this.sum || this.offered === 0) return null;
    return this.sum.map((value) => value / this.offered);
  }

  /**
   * Mean cosine distance of everything added, about `center` — the same number
   * the old two-pass `dispersion(vectors, center)` produced.
   *
   * Derivation, which is why no second read of the vectors is needed:
   *
   *   mean cos(v, c) = (1/N) Σ (v·c)/(|v||c|)
   *                  = (1/(N|c|)) · (Σ v/|v|) · c
   *
   * so the running Σ v/|v| above is sufficient once the centroid is known.
   * Re-reading half the user's history to get this cost more than the whole
   * first pass did.
   */
  dispersionAbout(center: number[]): number {
    if (!this.unitSum || this.offered === 0) return 0;
    const centerNorm = norm(center);
    if (centerNorm === 0) return 0;
    return 1 - dot(this.unitSum, center) / (this.offered * centerNorm);
  }
}

/** How many embeddings to hold in memory at once while streaming. */
const EMBEDDING_PAGE = 200;

/**
 * Reads embeddings for `ids` a page at a time, handing each to `visit`.
 *
 * The page is the only thing resident, so peak memory is bounded by
 * EMBEDDING_PAGE regardless of how much history the user has.
 */
async function forEachEmbedding(
  db: DbClient,
  ids: string[],
  visit: (id: string, embedding: number[]) => void,
): Promise<void> {
  for (let offset = 0; offset < ids.length; offset += EMBEDDING_PAGE) {
    const rows = await db.capturedItem.findMany({
      where: { id: { in: ids.slice(offset, offset + EMBEDDING_PAGE) } },
      select: { id: true, embedding: true },
    });
    for (const row of rows) {
      if (row.embedding && row.embedding.length > 0) visit(row.id, row.embedding);
    }
  }
}

// ── the loaded shape ────────────────────────────────────────────────────────

interface LoadedCapture {
  id: string;
  ms: number;
  fields: string[]; // general topics
  specifics: string[]; // non-general topics
  primaryTopic: string | null; // first specific, else first field
  source: string | null; // publisher / site
  voice: string | null; // author / creator
}

function countN(names: (string | null | undefined)[], limit: number): TerrainCount[] {
  const counts = new Map<string, number>();
  for (const name of names) {
    const n = name?.trim();
    if (!n) continue;
    counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function topShares(mentions: string[], limit: number): TerrainField[] {
  const counts = new Map<string, number>();
  for (const name of mentions) counts.set(name, (counts.get(name) ?? 0) + 1);
  const total = mentions.length || 1;
  return [...counts.entries()]
    .map(([name, count]) => ({ name, share: count / total }))
    .sort((a, b) => b.share - a.share)
    .slice(0, limit);
}

function rankByCount(names: string[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name)
    .slice(0, limit);
}

function monthRange(startMs: number, endMs: number): string {
  const a = new Date(startMs);
  const b = new Date(endMs);
  const am = MONTHS_SHORT[a.getUTCMonth()];
  const bm = MONTHS_SHORT[b.getUTCMonth()];
  if (a.getUTCFullYear() === b.getUTCFullYear() && am === bm) {
    return `${am} ${a.getUTCFullYear()}`;
  }
  const ay = a.getUTCFullYear();
  const by = b.getUTCFullYear();
  return ay === by ? `${am}–${bm} ${by}` : `${am} ${ay} – ${bm} ${by}`;
}

function driftBandFor(deg: number): TerrainResponse["driftBand"] {
  if (deg < 6) return "settled";
  if (deg < 14) return "a subtle drift";
  if (deg < 26) return "a real turn";
  return "a decisive shift";
}

// ── main ────────────────────────────────────────────────────────────────────

export async function getTerrain(
  userId: string,
  options: { tzOffsetMinutes?: number } = {},
  db: DbClient = prisma,
): Promise<TerrainResponse> {
  const tzShiftMs = (Number.isFinite(options.tzOffsetMinutes) ? (options.tzOffsetMinutes as number) : 0) * 60_000;

  const captureCount = await db.capturedItem.count({ where: { userId } });
  if (captureCount < TERRAIN_MIN_CAPTURES) return LOCKED(captureCount);

  // Fold the schema into the version so a shape change invalidates old caches.
  const cacheVersion = Math.floor(captureCount / CACHE_BUCKET) * 100 + TERRAIN_SCHEMA;
  // Best-effort read: if the cache table isn't there yet (pre-migration) or the
  // read fails, fall through and recompute rather than failing the request.
  try {
    const cached = await db.terrainCache.findUnique({ where: { userId } });
    if (cached && cached.version === cacheVersion) {
      const payload = cached.payload as unknown as TerrainResponse;
      if (payload && payload.unlocked && payload.captureCount) return payload;
    }
  } catch {
    // no cache available — recompute
  }

  const result = await computeTerrain(userId, tzShiftMs, captureCount, db);

  try {
    await db.terrainCache.upsert({
      where: { userId },
      update: { version: cacheVersion, payload: result as unknown as Prisma.InputJsonValue },
      create: { userId, version: cacheVersion, payload: result as unknown as Prisma.InputJsonValue },
    });
  } catch {
    // Best-effort: a failed cache write must never fail the request.
  }

  return result;
}

async function computeTerrain(
  userId: string,
  tzShiftMs: number,
  captureCount: number,
  db: DbClient,
): Promise<TerrainResponse> {
  const rows = await db.capturedItem.findMany({
    where: { userId },
    orderBy: { capturedAt: "asc" },
    // No embedding here: it is fetched in bounded pages further down, because
    // this query has no limit — it is the user's whole history by design.
    select: {
      id: true,
      capturedAt: true,
      topics: { select: { topic: { select: { name: true } } } },
      contentItem: {
        select: {
          siteName: true,
          authorName: true,
          source: { select: { name: true } },
        },
      },
    },
  });

  const captures: LoadedCapture[] = rows.map((r) => {
    const fields: string[] = [];
    const specifics: string[] = [];
    for (const link of r.topics) {
      const name = link.topic.name;
      (isGeneralTopic(name) ? fields : specifics).push(name);
    }
    return {
      id: r.id,
      ms: new Date(r.capturedAt).getTime() + tzShiftMs,
      fields,
      specifics,
      primaryTopic: specifics[0] ?? fields[0] ?? null,
      source: r.contentItem?.source?.name ?? r.contentItem?.siteName ?? null,
      voice: r.contentItem?.authorName ?? null,
    };
  });

  const n = captures.length;
  const frac = n >= TERRAIN_TIGHTEN_AT ? 0.25 : 1 / 3;
  const eraSize = Math.max(1, Math.floor(n * frac));
  const early = captures.slice(0, eraSize);
  const recent = captures.slice(n - eraSize);

  // ── semantic chapters (embedding-based) ──
  // Streamed in pages: every use below is an aggregate, so the vectors are
  // summed as they arrive and never all held at once.
  const earlyIds = new Set(early.map((c) => c.id));
  const recentIds = new Set(recent.map((c) => c.id));
  const fieldsById = new Map(captures.map((c) => [c.id, c.fields] as const));

  const earlyCentroidAcc = new RunningCentroid();
  const recentCentroidAcc = new RunningCentroid();
  const overallAcc = new RunningCentroid();
  const fieldAccs = new Map<string, RunningCentroid>();

  await forEachEmbedding(db, captures.map((c) => c.id), (id, embedding) => {
    overallAcc.add(embedding);
    if (earlyIds.has(id)) earlyCentroidAcc.add(embedding);
    if (recentIds.has(id)) recentCentroidAcc.add(embedding);

    for (const field of new Set(fieldsById.get(id) ?? [])) {
      let acc = fieldAccs.get(field);
      if (!acc) {
        acc = new RunningCentroid();
        fieldAccs.set(field, acc);
      }
      acc.add(embedding);
    }
  });

  let driftDegrees: number | null = null;
  let driftBand: TerrainResponse["driftBand"] = null;
  let towardField: string | null = null;
  let awayField: string | null = null;
  let earlySpread: number | null = null;
  let recentSpread: number | null = null;
  let spreadVerdict: TerrainResponse["spreadVerdict"] = null;
  let spreadDeltaPct: number | null = null;

  if (
    earlyCentroidAcc.count >= MIN_EMBEDDED_PER_ERA &&
    recentCentroidAcc.count >= MIN_EMBEDDED_PER_ERA
  ) {
    const earlyCentroid = earlyCentroidAcc.mean()!;
    const recentCentroid = recentCentroidAcc.mean()!;
    const overall = overallAcc.mean()!;

    const cos = cosSim(earlyCentroid, recentCentroid);
    driftDegrees = Math.round((Math.acos(cos) * 180) / Math.PI);
    driftBand = driftBandFor(driftDegrees);

    const driftVec = sub(recentCentroid, earlyCentroid);

    // Which field the movement points toward / away from: align each field's
    // capture-centroid (relative to the overall centre) with the drift vector.
    let bestAlign = -Infinity;
    let worstAlign = Infinity;
    for (const [name, acc] of fieldAccs) {
      if (acc.count < 3) continue;
      const align = cosSim(sub(acc.mean()!, overall), driftVec);
      if (align > bestAlign) {
        bestAlign = align;
        towardField = name;
      }
      if (align < worstAlign) {
        worstAlign = align;
        awayField = name;
      }
    }
    if (towardField === awayField) awayField = null;

    const eSpreadRaw = earlyCentroidAcc.dispersionAbout(earlyCentroid);
    const rSpreadRaw = recentCentroidAcc.dispersionAbout(recentCentroid);
    earlySpread = Math.round(eSpreadRaw * 1000);
    recentSpread = Math.round(rSpreadRaw * 1000);
    spreadVerdict =
      rSpreadRaw > eSpreadRaw * 1.1 ? "widening" : rSpreadRaw < eSpreadRaw * 0.9 ? "deepening" : "steady";
    spreadDeltaPct = eSpreadRaw > 0 ? Math.round(((rSpreadRaw - eSpreadRaw) / eSpreadRaw) * 100) : null;
  }

  const earlyDistinctTopics = new Set(early.flatMap((cap) => cap.specifics)).size;
  const recentDistinctTopics = new Set(recent.flatMap((cap) => cap.specifics)).size;

  // What/who you consume, across the whole history.
  const topSources = countN(captures.map((cap) => cap.source), 5);
  const topVoices = countN(captures.map((cap) => cap.voice), 5);

  // ── composition chapters (topic-based) ──
  const earlyFields = topShares(early.flatMap((c) => c.fields), 5);
  const recentFields = topShares(recent.flatMap((c) => c.fields), 5);

  const earlySpecificSet = new Set(early.flatMap((c) => c.specifics));
  const recentSpecificSet = new Set(recent.flatMap((c) => c.specifics));
  const allSpecific = captures.flatMap((c) => c.specifics);

  const enduring = rankByCount(
    allSpecific.filter((name) => earlySpecificSet.has(name) && recentSpecificSet.has(name)),
    6,
  );
  const emerged = rankByCount(
    recent.flatMap((c) => c.specifics).filter((name) => !earlySpecificSet.has(name)),
    6,
  );
  const faded = rankByCount(
    early.flatMap((c) => c.specifics).filter((name) => !recentSpecificSet.has(name)),
    6,
  );

  // ── bridges: cross-domain connections formed in the recent era ──
  const recentStart = recent[0]?.ms ?? Date.now();
  const recentStartUtc = new Date(recentStart - tzShiftMs);
  const edgeRows = await db.memoryEdge.findMany({
    where: { userId, createdAt: { gte: recentStartUtc } },
    orderBy: { weight: "desc" },
    select: {
      fromItem: { select: { topics: { select: { topic: { select: { name: true } } } } } },
      toItem: { select: { topics: { select: { topic: { select: { name: true } } } } } },
    },
    take: 200,
  });

  const primaryOf = (topics: { topic: { name: string } }[]): string | null => {
    const names = topics.map((t) => t.topic.name);
    return names.find((nm) => !isGeneralTopic(nm)) ?? names[0] ?? null;
  };
  const seenPairs = new Set<string>();
  const bridges: TerrainBridge[] = [];
  for (const e of edgeRows) {
    const a = primaryOf(e.fromItem.topics);
    const b = primaryOf(e.toItem.topics);
    if (!a || !b || a === b) continue;
    const key = [a, b].sort().join("→");
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    bridges.push({ a, b });
    if (bridges.length >= 4) break;
  }
  const bridgeCount = seenPairs.size;

  // ── convictions ──
  const positions = await db.userPosition.findMany({
    where: { userId },
    select: { challenges: { select: { revised: true } } },
  });
  const positionsStaked = positions.length;
  let positionsChallenged = 0;
  let positionsRevised = 0;
  for (const p of positions) {
    if (p.challenges.length > 0) positionsChallenged += 1;
    if (p.challenges.some((ch) => ch.revised)) positionsRevised += 1;
  }

  const earlyLabel = monthRange(early[0].ms, early[early.length - 1].ms);
  const recentLabel = monthRange(recent[0].ms, recent[recent.length - 1].ms);

  const base: TerrainResponse = {
    unlocked: true,
    captureCount,
    eraSize,
    earlyLabel,
    recentLabel,
    driftDegrees,
    driftBand,
    towardField,
    awayField,
    earlySpread,
    recentSpread,
    spreadVerdict,
    spreadDeltaPct,
    earlyDistinctTopics,
    recentDistinctTopics,
    earlyFields,
    recentFields,
    enduring,
    emerged,
    faded,
    topSources,
    topVoices,
    bridges,
    bridgeCount,
    positionsStaked,
    positionsChallenged,
    positionsRevised,
    arc: null,
  };

  base.arc = await generateTerrainNarrative({
    spanDays: Math.max(1, Math.round((recent[recent.length - 1].ms - early[0].ms) / DAY_MS)),
    captureCount,
    driftDegrees,
    driftBand,
    towardField,
    awayField,
    spreadVerdict,
    earlyFields: earlyFields.map((f) => f.name),
    recentFields: recentFields.map((f) => f.name),
    enduring,
    emerged,
    faded,
    bridges,
    topVoices: topVoices.map((v) => v.name),
    spreadDeltaPct,
  });

  return base;
}
