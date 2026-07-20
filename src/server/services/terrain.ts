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

  earlyFields: TerrainField[];
  recentFields: TerrainField[];
  enduring: string[];
  emerged: string[];
  faded: string[];

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
  earlyFields: [],
  recentFields: [],
  enduring: [],
  emerged: [],
  faded: [],
  bridges: [],
  bridgeCount: 0,
  positionsStaked: 0,
  positionsChallenged: 0,
  positionsRevised: 0,
  arc: null,
});

// ── vector helpers ──────────────────────────────────────────────────────────

function centroid(vectors: number[][]): number[] | null {
  if (vectors.length === 0) return null;
  const dim = vectors[0].length;
  if (dim === 0) return null;
  const sum = new Array<number>(dim).fill(0);
  for (const v of vectors) {
    if (v.length !== dim) continue;
    for (let i = 0; i < dim; i += 1) sum[i] += v[i];
  }
  for (let i = 0; i < dim; i += 1) sum[i] /= vectors.length;
  return sum;
}

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

/** Mean cosine distance of each vector to the group centroid — how scattered the group is. */
function dispersion(vectors: number[][], center: number[]): number {
  if (vectors.length === 0) return 0;
  let total = 0;
  for (const v of vectors) total += 1 - cosSim(v, center);
  return total / vectors.length;
}

// ── the loaded shape ────────────────────────────────────────────────────────

interface LoadedCapture {
  ms: number;
  embedding: number[];
  fields: string[]; // general topics
  specifics: string[]; // non-general topics
  primaryTopic: string | null; // first specific, else first field
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

  const bucket = Math.floor(captureCount / CACHE_BUCKET);
  // Best-effort read: if the cache table isn't there yet (pre-migration) or the
  // read fails, fall through and recompute rather than failing the request.
  try {
    const cached = await db.terrainCache.findUnique({ where: { userId } });
    if (cached && cached.version === bucket) {
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
      update: { version: bucket, payload: result as unknown as Prisma.InputJsonValue },
      create: { userId, version: bucket, payload: result as unknown as Prisma.InputJsonValue },
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
    select: {
      capturedAt: true,
      embedding: true,
      topics: { select: { topic: { select: { name: true } } } },
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
      ms: new Date(r.capturedAt).getTime() + tzShiftMs,
      embedding: r.embedding ?? [],
      fields,
      specifics,
      primaryTopic: specifics[0] ?? fields[0] ?? null,
    };
  });

  const n = captures.length;
  const frac = n >= TERRAIN_TIGHTEN_AT ? 0.25 : 1 / 3;
  const eraSize = Math.max(1, Math.floor(n * frac));
  const early = captures.slice(0, eraSize);
  const recent = captures.slice(n - eraSize);

  // ── semantic chapters (embedding-based) ──
  const earlyVecs = early.map((c) => c.embedding).filter((v) => v.length > 0);
  const recentVecs = recent.map((c) => c.embedding).filter((v) => v.length > 0);
  const allVecs = captures.map((c) => c.embedding).filter((v) => v.length > 0);

  let driftDegrees: number | null = null;
  let driftBand: TerrainResponse["driftBand"] = null;
  let towardField: string | null = null;
  let awayField: string | null = null;
  let earlySpread: number | null = null;
  let recentSpread: number | null = null;
  let spreadVerdict: TerrainResponse["spreadVerdict"] = null;

  if (earlyVecs.length >= MIN_EMBEDDED_PER_ERA && recentVecs.length >= MIN_EMBEDDED_PER_ERA) {
    const earlyCentroid = centroid(earlyVecs)!;
    const recentCentroid = centroid(recentVecs)!;
    const overall = centroid(allVecs)!;

    const cos = cosSim(earlyCentroid, recentCentroid);
    driftDegrees = Math.round((Math.acos(cos) * 180) / Math.PI);
    driftBand = driftBandFor(driftDegrees);

    const driftVec = sub(recentCentroid, earlyCentroid);

    // Which field the movement points toward / away from: align each field's
    // capture-centroid (relative to the overall centre) with the drift vector.
    const fieldVecs = new Map<string, number[][]>();
    for (const cap of captures) {
      if (cap.embedding.length === 0) continue;
      for (const f of new Set(cap.fields)) {
        const arr = fieldVecs.get(f) ?? [];
        arr.push(cap.embedding);
        fieldVecs.set(f, arr);
      }
    }
    let bestAlign = -Infinity;
    let worstAlign = Infinity;
    for (const [name, vecs] of fieldVecs) {
      if (vecs.length < 3) continue;
      const fc = centroid(vecs)!;
      const align = cosSim(sub(fc, overall), driftVec);
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

    const eSpreadRaw = dispersion(earlyVecs, earlyCentroid);
    const rSpreadRaw = dispersion(recentVecs, recentCentroid);
    earlySpread = Math.round(eSpreadRaw * 1000);
    recentSpread = Math.round(rSpreadRaw * 1000);
    spreadVerdict =
      rSpreadRaw > eSpreadRaw * 1.1 ? "widening" : rSpreadRaw < eSpreadRaw * 0.9 ? "deepening" : "steady";
  }

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
    earlyFields,
    recentFields,
    enduring,
    emerged,
    faded,
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
  });

  return base;
}
