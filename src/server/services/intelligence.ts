import { MemoryEdgeType, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/server/db";
import {
  generateContradictionTension,
  generateThreadSynthesis,
  generateConvergenceSignal,
  generateTopicTension,
} from "@/server/cognition/llm";
import { isGeneralTopic } from "@/server/cognition/generalTopics";

// Thresholds are deliberately low so insights start surfacing within the
// first handful of captures and keep refreshing as new ones land. Mind is a
// living picture of how you're thinking, not a report that only appears once
// you've amassed a large archive.
const DORMANT_ACTIVE_MIN = 2;
const DORMANT_SILENT_DAYS = 14;
const DORMANT_LIMIT = 4;
const CONVERGENCE_SOURCE_MIN = 2;
const CONVERGENCE_LIMIT = 5;
const CAPTURE_SCAN_LIMIT = 200;
const CONTRADICTION_EDGE_LIMIT = 6;
const CONTRADICTION_CARD_LIMIT = 8;
// Topics with at least this many captures are scanned by the LLM for internal
// tension (friction / ambivalence / competing intuitions), not just the hard
// polarity-based CONTRADICTS edges.
const TOPIC_TENSION_MIN = 3;
const TOPIC_TENSION_SCAN = 6;
const THREAD_SYNTHESIS_THRESHOLD = 3;
// Room for new instruments to APPEAR rather than having to evict an existing
// one. The qualifying thresholds above are unchanged — a thread still needs
// real material behind it; there are simply more slots for the ones that earn it.
const THREAD_SYNTHESIS_LIMIT = 6;
const THREAD_ITEM_IDS_LIMIT = 12;
/**
 * Candidate topics are ranked by recency-weighted activity rather than raw
 * capture count. Ranking by count alone froze Mind: once a topic had built up
 * the biggest pile it held its slot forever, so the same threads / tensions /
 * convergences were reported no matter how much new material landed elsewhere.
 * With a 30-day half-life a topic you've been feeding this month outranks one
 * you left behind last year, and Mind moves as your attention does.
 */
const ACTIVITY_HALF_LIFE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Cached LLM entries kept between runs — enough to cover topics that drop out
 * of the shortlist for a while and come back without re-billing. */
const ENTRY_CACHE_LIMIT = 160;

/** A URL-shaped description is a stub row from a failed scrape (paywall,
 * robot wall) — never treat the link itself as the capture's substance. */
function descriptionIfReal(description: string | null | undefined): string | null {
  const trimmed = description?.trim() ?? "";
  if (!trimmed || /^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

export type LoadedCapture = {
  id: string;
  label: string;
  rawText: string | null;
  /** Best available account of the capture's substance for LLM grounding:
   * user's own text, else their context note, else the AI summary/excerpt.
   * Link captures have rawText = null, so without this they were title-only. */
  gist: string;
  keyIdea: string | null;
  capturedAt: Date;
  sourceName: string | null;
  topics: { topicId: string; name: string }[];
};

export type TopicGroup = {
  topicId: string;
  topicName: string;
  captures: LoadedCapture[];
};

/** A small node the visualizations can render and deep-link (→ /insight/id). */
export type IntelNode = {
  id: string;
  label: string;
};

export type ContradictionCard = {
  itemAId: string;
  itemBId: string;
  labelA: string;
  labelB: string;
  previewA: string;
  previewB: string;
  tension: string;
  /** The question at stake, ≤ 8 words — sits inside the fracture UI. */
  crux: string | null;
  /** One concrete way for the user to settle which side they hold. */
  test: string | null;
  /** Captures that reinforce each pole — the two opposing masses either side
   * of the FractureZone chasm. May be empty (the pole stands alone). */
  sideA: IntelNode[];
  sideB: IntelNode[];
};

export type ThreadTimelineNode = IntelNode & { capturedAt: string };

export type ThreadDrift = {
  /** Index into `timeline` the note sits after. */
  atIndex: number;
  text: string;
};

export type ThreadSynthesis = {
  topicId: string;
  topicName: string;
  captureCount: number;
  position: string;
  openQuestion: string;
  /** The position compressed to 3-6 words — the strand's direction label. */
  heading: string | null;
  /** Capture ids feeding this thread — used to deep-link into companion/Atlas. */
  itemIds: string[];
  /** Chronological (oldest first) captures along the TemporalSpine. */
  timeline: ThreadTimelineNode[];
  /** AI observations of how thinking moved, keyed to timeline positions. */
  driftNotes: ThreadDrift[];
};

export type ConvergenceCluster = {
  source: string;
  items: IntelNode[];
};

export type ConvergenceSignal = {
  topicId: string;
  topicName: string;
  captureCount: number;
  sourceCount: number;
  signal: string;
  /** The destination idea compressed to ≤ 8 words — the keystone's label. */
  arrival: string | null;
  /** Where the convergence points next — one concrete move. */
  act: string | null;
  /** Captures grouped by origin source — the distinct masses the
   * KeystoneBridge pulls together. Largest sources first. */
  clusters: ConvergenceCluster[];
};

export type DormantThread = {
  topicId: string;
  topicName: string;
  captureCount: number;
  lastCapturedAt: string;
  daysSilent: number;
};

export type PersonalIntelligenceData = {
  /** Bumped whenever the response shape changes, so a client holding an older
   * payload can tell which fields it can rely on. */
  payloadVersion: number;
  contradictionCards: ContradictionCard[];
  threadSyntheses: ThreadSynthesis[];
  convergenceSignals: ConvergenceSignal[];
  dormantThreads: DormantThread[];
};

// v5: per-entry content-addressed cache + activity-ranked candidates.
const INTEL_PAYLOAD_VERSION = 5;

// ── per-entry LLM cache ─────────────────────────────────────────────────────
// Mind used to cache one monolithic payload keyed on tasteProfileVersion, which
// bumps on every capture. So a single new capture threw away every synthesis
// and the next Mind open re-billed ~16 LLM calls — expensive, slow, and it made
// the whole picture hostage to one section changing.
//
// Instead each LLM result is stored under a hash of the exact prompt input that
// produced it. A capture landing in one topic changes only that topic's inputs,
// so only its entries regenerate (~3 calls) and everything else is reused
// verbatim. Fresher AND cheaper, because freshness now costs only what actually
// moved.

const INTEL_CACHE_SCHEMA = 1;

type CacheEntry = { v: unknown; t: number };
type IntelCacheFile = { schema: number; entries: Record<string, CacheEntry> };

/** FNV-1a — a short, stable content address. Not security-sensitive. */
function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

function readCacheFile(payload: unknown): Record<string, CacheEntry> {
  const file = payload as IntelCacheFile | null;
  if (!file || file.schema !== INTEL_CACHE_SCHEMA || typeof file.entries !== "object" || !file.entries) {
    return {};
  }
  return file.entries;
}

/**
 * Resolves LLM results against the cache, keyed by their own input.
 * A null result (no API key, a failed call) is never cached — it must be free
 * to succeed on the next open rather than being frozen in as "nothing here".
 */
class EntryStore {
  private readonly existing: Record<string, CacheEntry>;
  private readonly touched = new Map<string, CacheEntry>();
  private produced = 0;

  constructor(existing: Record<string, CacheEntry>) {
    this.existing = existing;
  }

  async resolve<T>(prefix: string, input: unknown, produce: () => Promise<T | null>): Promise<T | null> {
    const key = `${prefix}:${fingerprint(JSON.stringify(input))}`;
    const hit = this.existing[key];
    if (hit) {
      this.touched.set(key, { v: hit.v, t: Date.now() });
      return hit.v as T;
    }
    const value = await produce();
    if (value !== null && value !== undefined) {
      this.touched.set(key, { v: value, t: Date.now() });
      this.produced += 1;
    }
    return value;
  }

  /** True when this run generated something the cache doesn't already hold. */
  get isDirty() {
    return this.produced > 0;
  }

  /** Everything used this run, plus the most recently used of the rest. */
  toFile(): IntelCacheFile {
    const merged: Record<string, CacheEntry> = {};
    const carryOver = Object.entries(this.existing)
      .filter(([key]) => !this.touched.has(key))
      .sort((a, b) => (b[1]?.t ?? 0) - (a[1]?.t ?? 0))
      .slice(0, Math.max(0, ENTRY_CACHE_LIMIT - this.touched.size));
    for (const [key, entry] of carryOver) merged[key] = entry;
    for (const [key, entry] of this.touched) merged[key] = entry;
    return { schema: INTEL_CACHE_SCHEMA, entries: merged };
  }
}

/**
 * Recency-weighted weight of a topic group: each capture contributes 1 when
 * fresh, decaying by half every {@link ACTIVITY_HALF_LIFE_DAYS}.
 */
export function activityScore(group: TopicGroup, now: Date): number {
  let score = 0;
  for (const capture of group.captures) {
    const ageDays = Math.max(0, (now.getTime() - capture.capturedAt.getTime()) / DAY_MS);
    score += Math.pow(0.5, ageDays / ACTIVITY_HALF_LIFE_DAYS);
  }
  return score;
}

/** Most-alive topics first, breaking ties on raw size. */
export function rankByActivity(groups: TopicGroup[], now: Date): TopicGroup[] {
  return [...groups]
    .map((group) => ({ group, score: activityScore(group, now) }))
    .sort((a, b) => b.score - a.score || b.group.captures.length - a.group.captures.length)
    .map((entry) => entry.group);
}

/**
 * Specific sub-topics first, coarse fields only as fill.
 *
 * Every capture is filed under one of 26 general fields, so the general groups
 * are always the biggest AND the most recently fed — they won every slot on any
 * size- or activity-based ranking, forever. That is why Mind never moved: its
 * threads were "philosophy" and "technology", and another philosophy capture
 * just made an unchanging group marginally bigger.
 *
 * Specifics ("stoicism", "attention mechanisms") are where thinking actually
 * develops, there are far more of them, and they turn over as you read — so new
 * threads and convergences genuinely appear. Fields still fill any spare slots,
 * which keeps a young account from having an empty Mind.
 */
export function preferSpecific(groups: TopicGroup[], limit: number): TopicGroup[] {
  const specific = groups.filter((g) => !isGeneralTopic(g.topicName));
  if (specific.length >= limit) return specific.slice(0, limit);
  return [...specific, ...groups.filter((g) => isGeneralTopic(g.topicName))].slice(0, limit);
}

// ── background warming ──────────────────────────────────────────────────────

/** Long enough that a burst of captures (a share-sheet session, a batch of
 * links) collapses into one rebuild instead of one per item. */
const WARM_DELAY_MS = 45_000;
const warmTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Rebuilds the changed parts of a user's Mind shortly after a capture, so the
 * new material is already woven in by the time they open the tab rather than
 * being generated while they wait on it.
 *
 * Deliberately conditional on the user already having an intelligence cache
 * row — i.e. having opened Mind at least once. Someone who never looks at Mind
 * never pays for this. For someone who does, it is not extra spend: it is the
 * same delta they would have been billed for on open, moved off their critical
 * path. Repeated calls debounce, so a run of captures costs one rebuild.
 */
export function scheduleIntelligenceWarm(userId: string, db?: DbClient): void {
  const existing = warmTimers.get(userId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    warmTimers.delete(userId);
    void (async () => {
      const client = db ?? prisma;
      const seen = await client.intelligenceCache.findUnique({
        where: { userId },
        select: { userId: true },
      });
      if (!seen) return;
      await getPersonalIntelligence({ userId, db: client });
    })().catch((err) => console.error("[intelligence] background warm failed", err));
  }, WARM_DELAY_MS);

  // Never hold the process open just to warm a cache.
  (timer as { unref?: () => void }).unref?.();
  warmTimers.set(userId, timer);
}

export function groupCapturesByTopic(captures: LoadedCapture[], minCount: number): TopicGroup[] {
  const map = new Map<string, TopicGroup>();
  for (const capture of captures) {
    for (const topic of capture.topics) {
      const existing = map.get(topic.topicId);
      if (existing) {
        existing.captures.push(capture);
      } else {
        map.set(topic.topicId, {
          topicId: topic.topicId,
          topicName: topic.name,
          captures: [capture],
        });
      }
    }
  }
  return Array.from(map.values())
    .filter((g) => g.captures.length >= minCount)
    .sort((a, b) => b.captures.length - a.captures.length);
}

export function findDormantThreads(topicGroups: TopicGroup[], now: Date): DormantThread[] {
  const dormantCutoff = new Date(now.getTime() - DORMANT_SILENT_DAYS * 24 * 60 * 60 * 1000);
  const result: DormantThread[] = [];

  for (const group of topicGroups) {
    if (group.captures.length < DORMANT_ACTIVE_MIN) continue;
    const sorted = [...group.captures].sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime());
    const last = sorted[0];
    if (last.capturedAt < dormantCutoff) {
      result.push({
        topicId: group.topicId,
        topicName: group.topicName,
        captureCount: group.captures.length,
        lastCapturedAt: last.capturedAt.toISOString(),
        daysSilent: Math.floor((now.getTime() - last.capturedAt.getTime()) / (24 * 60 * 60 * 1000)),
      });
    }
  }

  return result.sort((a, b) => b.captureCount - a.captureCount).slice(0, DORMANT_LIMIT);
}

export function findConvergenceCandidates(topicGroups: TopicGroup[]): TopicGroup[] {
  return topicGroups.filter((group) => {
    const sources = new Set(group.captures.map((c) => c.sourceName ?? "__unknown__"));
    return sources.size >= CONVERGENCE_SOURCE_MIN;
  });
}

/**
 * Greedy de-duplication of topic groups that are really the same cluster of
 * captures under two labels (e.g. "philosophy" and "consciousness" holding
 * the same items). A group is skipped when it shares more than `maxOverlap`
 * of its captures with an already-picked group — the reader should never see
 * the same insight twice under different names.
 */
export function diversifyGroups(groups: TopicGroup[], limit: number, maxOverlap = 0.6): TopicGroup[] {
  const picked: TopicGroup[] = [];
  for (const group of groups) {
    if (picked.length >= limit) break;
    const ids = new Set(group.captures.map((c) => c.id));
    const nearDuplicate = picked.some((p) => {
      const shared = p.captures.filter((c) => ids.has(c.id)).length;
      return shared / Math.min(p.captures.length, group.captures.length) > maxOverlap;
    });
    if (!nearDuplicate) picked.push(group);
  }
  return picked;
}

export async function getPersonalIntelligence(args: {
  userId: string;
  db?: DbClient;
}): Promise<PersonalIntelligenceData> {
  const db = args.db ?? prisma;

  // Everything structural (which topics qualify, the timelines, the clusters,
  // the satellites, dormancy) is rebuilt from the DB on every request — it is
  // pure queries, so it is always current. Only the LLM prose is cached, and
  // that is cached per entry against its own input (see EntryStore), so a new
  // capture refreshes exactly the sections it touches.
  const [user, cached, rawCaptures] = await Promise.all([
    db.user.findUnique({
      where: { id: args.userId },
      select: { tasteProfileVersion: true },
    }),
    db.intelligenceCache.findUnique({ where: { userId: args.userId } }),
    db.capturedItem.findMany({
      where: { userId: args.userId },
      orderBy: { capturedAt: "desc" },
      take: CAPTURE_SCAN_LIMIT,
      // Exactly the fields the projection below reads. Via `include` this was
      // ~5MB of embeddings and scraped article bodies per request, and it runs
      // before the cache check, so even a cache HIT paid for it.
      select: {
        id: true,
        rawText: true,
        userContext: true,
        summary: true,
        keyIdea: true,
        capturedAt: true,
        contentItem: {
          select: {
            title: true,
            description: true,
            siteName: true,
            source: { select: { name: true } },
          },
        },
        topics: { select: { topicId: true, topic: { select: { name: true } } } },
      },
    }),
  ]);

  const captures: LoadedCapture[] = rawCaptures.map((item) => ({
    id: item.id,
    label: item.contentItem?.title ?? item.rawText?.slice(0, 80) ?? "Untitled capture",
    rawText: item.rawText,
    // A URL-shaped description is a stub from a failed scrape — grounding an
    // LLM on the link itself invites confabulation, so skip it.
    gist: [item.rawText, item.userContext, item.summary, descriptionIfReal(item.contentItem?.description)]
      .find((part) => part && part.trim().length > 0) ?? "",
    keyIdea: item.keyIdea,
    capturedAt: item.capturedAt,
    sourceName: item.contentItem?.source?.name ?? item.contentItem?.siteName ?? null,
    topics: item.topics.map((row) => ({ topicId: row.topicId, name: row.topic.name })),
  }));

  const now = new Date();
  const allGroups = groupCapturesByTopic(captures, 2);
  // Ranked by living activity, not lifetime size — otherwise the same handful
  // of long-established topics hold every slot forever.
  const activeGroups = rankByActivity(allGroups, now);
  // A coarse field can't go dormant while you keep reading anything nearby, so
  // dormancy is only meaningful for the specific threads you actually dropped.
  const dormantThreads = findDormantThreads(
    activeGroups.filter((g) => !isGeneralTopic(g.topicName)),
    now,
  );
  const threadCandidates = preferSpecific(
    activeGroups.filter((g) => g.captures.length >= THREAD_SYNTHESIS_THRESHOLD),
    THREAD_SYNTHESIS_LIMIT,
  );

  const store = new EntryStore(readCacheFile(cached?.payload));

  const contradictEdges = await db.memoryEdge.findMany({
    where: { userId: args.userId, type: MemoryEdgeType.CONTRADICTS },
    orderBy: { createdAt: "desc" },
    take: CONTRADICTION_EDGE_LIMIT,
    include: {
      fromItem: { include: { contentItem: true } },
      toItem: { include: { contentItem: true } },
    },
  });

  const convergenceCandidates = diversifyGroups(
    preferSpecific(findConvergenceCandidates(activeGroups), CONVERGENCE_LIMIT * 2),
    CONVERGENCE_LIMIT,
  );

  // Pairs already captured as hard CONTRADICTS edges — so the softer LLM
  // tension scan doesn't surface the same pair twice.
  const edgePairKeys = new Set(
    contradictEdges.flatMap((e) => [
      `${e.fromItemId}:${e.toItemId}`,
      `${e.toItemId}:${e.fromItemId}`,
    ]),
  );
  const tensionGroups = preferSpecific(
    activeGroups.filter((g) => g.captures.length >= TOPIC_TENSION_MIN),
    TOPIC_TENSION_SCAN,
  );

  function edgeItemLabel(item: { rawText: string | null; contentItem: { title: string } | null }): string {
    return item.contentItem?.title ?? item.rawText?.slice(0, 80) ?? "Untitled capture";
  }

  function edgeItemText(item: {
    rawText: string | null;
    userContext: string | null;
    summary: string | null;
    keyIdea: string | null;
    contentItem: { description: string | null } | null;
  }): string {
    return [item.rawText, item.userContext, item.summary, descriptionIfReal(item.contentItem?.description), item.keyIdea]
      .find((part) => part && part.trim().length > 0) ?? "";
  }

  // The spine is chronological: the 10 most recent captures per thread, oldest
  // first, so the LLM's drift notes index into the same order the UI renders.
  const threadChrono = threadCandidates.map((group) =>
    [...group.captures]
      .sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime())
      .slice(-10),
  );

  // Each prompt is built first, then resolved through the store: the built
  // input IS the cache key, so a result can only be reused when the exact
  // material behind it is unchanged.
  const contradictionInputs = contradictEdges.map((edge) => ({
    labelA: edgeItemLabel(edge.fromItem),
    textA: edgeItemText(edge.fromItem),
    labelB: edgeItemLabel(edge.toItem),
    textB: edgeItemText(edge.toItem),
  }));
  const threadInputs = threadCandidates.map((group, i) => ({
    topicName: group.topicName,
    captures: threadChrono[i].map((c) => ({
      label: c.label,
      keyIdea: c.keyIdea,
      text: c.gist,
      capturedAt: c.capturedAt.toISOString().slice(0, 10),
    })),
  }));
  const convergenceInputs = convergenceCandidates.map((group) => ({
    topicName: group.topicName,
    captures: group.captures.slice(0, 8).map((c) => ({
      label: c.label,
      source: c.sourceName,
      keyIdea: c.keyIdea,
    })),
  }));
  const tensionInputs = tensionGroups.map((group) => ({
    topicName: group.topicName,
    captures: group.captures.slice(0, 8).map((c) => ({
      label: c.label,
      keyIdea: c.keyIdea,
      text: c.gist,
    })),
  }));

  const [cardTensions, syntheses, convergenceTexts, topicTensions] = await Promise.all([
    Promise.all(contradictionInputs.map((input) => store.resolve("con", input, () => generateContradictionTension(input)))),
    Promise.all(threadInputs.map((input) => store.resolve("thr", input, () => generateThreadSynthesis(input)))),
    Promise.all(convergenceInputs.map((input) => store.resolve("cnv", input, () => generateConvergenceSignal(input)))),
    Promise.all(tensionInputs.map((input) => store.resolve("ten", input, () => generateTopicTension(input)))),
  ]);

  const edgeCards: ContradictionCard[] = contradictEdges
    .map((edge, i) => {
      const insight = cardTensions[i];
      if (!insight) return null;
      return {
        itemAId: edge.fromItemId,
        itemBId: edge.toItemId,
        labelA: edgeItemLabel(edge.fromItem),
        labelB: edgeItemLabel(edge.toItem),
        previewA: edgeItemText(edge.fromItem).slice(0, 200),
        previewB: edgeItemText(edge.toItem).slice(0, 200),
        tension: insight.tension,
        crux: insight.crux,
        test: insight.test,
        sideA: [] as IntelNode[],
        sideB: [] as IntelNode[],
      };
    })
    .filter((c): c is ContradictionCard => c !== null);

  const tensionCards: ContradictionCard[] = tensionGroups
    .map((group, i) => {
      const result = topicTensions[i];
      if (!result) return null;
      const a = group.captures[result.aIndex];
      const b = group.captures[result.bIndex];
      if (!a || !b || a.id === b.id) return null;
      if (edgePairKeys.has(`${a.id}:${b.id}`)) return null;
      return {
        itemAId: a.id,
        itemBId: b.id,
        labelA: a.label,
        labelB: b.label,
        previewA: a.gist.slice(0, 200),
        previewB: b.gist.slice(0, 200),
        tension: result.tension,
        crux: result.crux,
        test: result.test,
        sideA: [] as IntelNode[],
        sideB: [] as IntelNode[],
      };
    })
    .filter((c): c is ContradictionCard => c !== null);

  // Hard edges first, then softer topic tensions; dedupe by unordered pair.
  // Each capture also appears in at most ONE card — a well-connected item
  // (e.g. a storytelling essay that rubs against everything) would otherwise
  // fill the whole wall with itself wearing different partners.
  const seenPairs = new Set<string>();
  const usedItems = new Set<string>();
  const contradictionCards: ContradictionCard[] = [];
  for (const card of [...edgeCards, ...tensionCards]) {
    const key = [card.itemAId, card.itemBId].sort().join(":");
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    if (usedItems.has(card.itemAId) || usedItems.has(card.itemBId)) continue;
    usedItems.add(card.itemAId);
    usedItems.add(card.itemBId);
    contradictionCards.push(card);
    if (contradictionCards.length >= CONTRADICTION_CARD_LIMIT) break;
  }

  // Populate each pole's supporting mass: captures whose edges reinforce (or
  // recur with) the pole. Pure DB — no LLM cost. Empty sides are fine; the
  // FractureZone renders a lone pole just as well.
  const poleIds = Array.from(new Set(contradictionCards.flatMap((c) => [c.itemAId, c.itemBId])));
  if (poleIds.length > 0) {
    const satelliteEdges = await db.memoryEdge.findMany({
      where: {
        userId: args.userId,
        type: { in: [MemoryEdgeType.REINFORCES, MemoryEdgeType.RECURS] },
        OR: [{ fromItemId: { in: poleIds } }, { toItemId: { in: poleIds } }],
      },
      orderBy: { weight: "desc" },
      take: 80,
      include: {
        fromItem: { include: { contentItem: true } },
        toItem: { include: { contentItem: true } },
      },
    });
    const satellitesOf = new Map<string, IntelNode[]>();
    for (const edge of satelliteEdges) {
      const pairs = [
        { pole: edge.fromItemId, other: { id: edge.toItemId, label: edgeItemLabel(edge.toItem) } },
        { pole: edge.toItemId, other: { id: edge.fromItemId, label: edgeItemLabel(edge.fromItem) } },
      ];
      for (const { pole, other } of pairs) {
        if (!poleIds.includes(pole)) continue;
        const list = satellitesOf.get(pole) ?? [];
        if (list.length >= 3 || list.some((n) => n.id === other.id)) continue;
        list.push(other);
        satellitesOf.set(pole, list);
      }
    }
    for (const card of contradictionCards) {
      const exclude = new Set([card.itemAId, card.itemBId]);
      card.sideA = (satellitesOf.get(card.itemAId) ?? []).filter((n) => !exclude.has(n.id));
      card.sideB = (satellitesOf.get(card.itemBId) ?? []).filter((n) => !exclude.has(n.id));
    }
  }

  const threadSyntheses: ThreadSynthesis[] = threadCandidates
    .map((group, i) => {
      const synthesis = syntheses[i];
      if (!synthesis) return null;
      return {
        topicId: group.topicId,
        topicName: group.topicName,
        captureCount: group.captures.length,
        position: synthesis.position,
        openQuestion: synthesis.openQuestion,
        heading: synthesis.heading ?? null,
        itemIds: group.captures.slice(0, THREAD_ITEM_IDS_LIMIT).map((c) => c.id),
        timeline: threadChrono[i].map((c) => ({
          id: c.id,
          label: c.label,
          capturedAt: c.capturedAt.toISOString(),
        })),
        driftNotes: synthesis.driftNotes ?? [],
      };
    })
    .filter((s): s is ThreadSynthesis => s !== null);

  const convergenceSignals: ConvergenceSignal[] = convergenceCandidates
    .map((group, i) => {
      const signal = convergenceTexts[i];
      if (!signal) return null;
      const bySource = new Map<string, IntelNode[]>();
      for (const c of group.captures) {
        const source = c.sourceName ?? "elsewhere";
        const list = bySource.get(source) ?? [];
        if (list.length < 4) list.push({ id: c.id, label: c.label });
        bySource.set(source, list);
      }
      const clusters: ConvergenceCluster[] = Array.from(bySource.entries())
        .map(([source, items]) => ({ source, items }))
        .sort((a, b) => b.items.length - a.items.length)
        .slice(0, 3);
      return {
        topicId: group.topicId,
        topicName: group.topicName,
        captureCount: group.captures.length,
        sourceCount: new Set(group.captures.map((c) => c.sourceName ?? "__unknown__")).size,
        signal: signal.signal,
        arrival: signal.arrival,
        act: signal.act,
        clusters,
      };
    })
    .filter((s): s is ConvergenceSignal => s !== null);

  const result: PersonalIntelligenceData = {
    payloadVersion: INTEL_PAYLOAD_VERSION,
    contradictionCards,
    threadSyntheses,
    convergenceSignals,
    dormantThreads,
  };

  // Only written when this run actually generated something new — a fully warm
  // open costs zero LLM calls and zero writes.
  if (user && store.isDirty) {
    const file = store.toFile() as unknown as Prisma.InputJsonValue;
    // Best-effort: a failed cache write must never fail the request.
    try {
      await db.intelligenceCache.upsert({
        where: { userId: args.userId },
        update: { version: user.tasteProfileVersion, payload: file },
        create: { userId: args.userId, version: user.tasteProfileVersion, payload: file },
      });
    } catch {
      // ignore
    }
  }

  return result;
}
