import { InsightStyle, InsightType, MemoryEdgeType } from "@prisma/client";

export type Neighbor = {
  capturedItemId: string;
  title: string;
  similarity: number;
  topicJaccard: number;
  edgeType: MemoryEdgeType;
  capturedAt: Date;
};

export type TopicCount = {
  topicId: string;
  name: string;
  count: number;
};

export type TrajectoryShift = {
  topicId: string;
  name: string;
  recentCount: number;
  priorCount: number;
  delta: number;
};

export type InsightDraft = {
  type: InsightType;
  headline: string;
  body: string;
  evidence: Record<string, unknown>;
  strength: number;
};

const STYLE_VOICE: Record<InsightStyle, {
  pattern: (n: number, topic: string) => string;
  trajectoryUp: (topic: string) => string;
  trajectoryDown: (topic: string) => string;
  connection: (titles: string[]) => string;
  reinforces: (title: string) => string;
  contradicts: (title: string) => string;
  novelty: (topic?: string) => string;
  recur: (n: number, title: string) => string;
}> = {
  DIRECT: {
    pattern: (n, topic) => `${n} of your captures involve ${topic}.`,
    trajectoryUp: (topic) => `Your attention is shifting toward ${topic}.`,
    trajectoryDown: (topic) => `${topic} is fading from your attention.`,
    connection: (titles) => `Connects to: ${titles.join("; ")}.`,
    reinforces: (title) => `Reinforces an earlier capture: ${title}.`,
    contradicts: (title) => `This weakens an earlier belief: ${title}.`,
    novelty: (topic) => topic ? `Novel signal. First entry under ${topic}.` : "Novel signal. The graph begins here.",
    recur: (n, title) => `You have seen this pattern before. Closest: ${title}.`,
  },
  REFLECTIVE: {
    pattern: (n, topic) => `${topic} keeps returning — this is the ${n}th echo.`,
    trajectoryUp: (topic) => `Notice this: your mind is leaning into ${topic}.`,
    trajectoryDown: (topic) => `Notice this: ${topic} is quieter than it was.`,
    connection: (titles) => `Does this echo: ${titles.join("; ")}?`,
    reinforces: (title) => `This may strengthen what you already thought about ${title}.`,
    contradicts: (title) => `Does this disagree with ${title}?`,
    novelty: (topic) => topic ? `A new direction — ${topic} appears for the first time.` : "A new direction. The graph begins here.",
    recur: (_n, title) => `Have you seen this pattern before? Closest: ${title}.`,
  },
  ANALYTICAL: {
    pattern: (n, topic) => `Pattern: ${n} captures share topic "${topic}".`,
    trajectoryUp: (topic) => `Trajectory +: "${topic}" rising in recent window.`,
    trajectoryDown: (topic) => `Trajectory -: "${topic}" declining in recent window.`,
    connection: (titles) => `Top neighbors: ${titles.join("; ")}.`,
    reinforces: (title) => `Reinforcement: high-similarity neighbor — ${title}.`,
    contradicts: (title) => `Contradiction signal: shared topic, divergent terms — ${title}.`,
    novelty: (topic) => topic ? `Novelty: no prior captures under "${topic}".` : "Novelty: no prior captures.",
    recur: (n, title) => `Recurrence detected (n=${n}). Strongest: ${title}.`,
  },
};

export function draftInsights(args: {
  style: InsightStyle;
  itemTitle: string;
  topicNames: string[];
  topNeighbors: Neighbor[];
  topicCounts: TopicCount[];
  shift?: TrajectoryShift | null;
  isFirstCapture: boolean;
  /** When true, the capture is essentially title-only — suppress the generic
   * NOVELTY boilerplate (which describes the app rather than the content) and
   * emit only insights grounded in real neighbor/pattern signal. */
  contentThin?: boolean;
  /** Types of the user's most recent insights (newest first, ~6). Drives the
   * repetition guard: volume/direction readings (TRAJECTORY, PATTERN) that
   * already led the last few captures must clear a much higher bar to lead
   * again, so a burst of saves gets varied insights instead of "your
   * attention is shifting toward X" on every one. */
  recentInsightTypes?: InsightType[];
}): InsightDraft[] {
  const drafts: InsightDraft[] = [];
  const voice = STYLE_VOICE[args.style];
  const dominantTopic = args.topicNames[0];

  // Unreadable source: say so, plainly, and say nothing else. A thin capture
  // was embedded from its title alone (often just a hostname), so its
  // "neighbors" are artifacts of that junk embedding — two unreadable
  // paywalled links look near-identical to each other, which is how a fresh
  // stub earned a straight-faced "you have repeatedly saved articles from
  // nytimes.com" recurrence. Suppress every neighbor/pattern-derived draft
  // until the user says what the content was, which reprocesses the capture
  // and rebuilds real insights from real grounding.
  if (args.contentThin) {
    drafts.push({
      type: InsightType.NOVELTY,
      headline: "This source couldn't be read.",
      body: "The page itself couldn't be extracted — a paywall, a robot wall, or an unsupported format — so this capture is grounded only in its title so far. Tell mneme what it was about (About this capture → edit), and its topics, connections, and insight will be rebuilt from your words.",
      evidence: { contentThin: true },
      strength: 1,
    });
    return drafts;
  }

  if (args.isFirstCapture && !args.contentThin) {
    drafts.push({
      type: InsightType.NOVELTY,
      headline: voice.novelty(dominantTopic),
      body: dominantTopic
        ? `This is your first saved item under ${dominantTopic} — the graph begins here. Every subsequent capture in this area will build connections back to this one. Save a few more on the same topic and patterns will start to emerge.`
        : "This is your first capture in mneme — the memory graph starts here. As you add more items, the system will surface connections, recurring themes, and shifts in your thinking over time.",
      evidence: { dominantTopic },
      strength: 1,
    });
    return drafts;
  }

  const reinforcement = args.topNeighbors.find((n) => n.edgeType === MemoryEdgeType.REINFORCES);
  const contradiction = args.topNeighbors.find((n) => n.edgeType === MemoryEdgeType.CONTRADICTS);
  const recurrence = args.topNeighbors.find((n) => n.edgeType === MemoryEdgeType.RECURS);

  if (recurrence) {
    drafts.push({
      type: InsightType.RECUR,
      headline: voice.recur(args.topNeighbors.length, recurrence.title),
      body: `You have ${args.topNeighbors.length} semantically similar captures across your record, with "${recurrence.title}" being the closest match (similarity ${Number(recurrence.similarity.toFixed(2))}). Recurring encounters with the same ideas can signal either deep interest or an unresolved question that keeps pulling you back. It may be worth asking what new angle — if any — this capture adds.`,
      evidence: {
        capturedItemId: recurrence.capturedItemId,
        similarity: Number(recurrence.similarity.toFixed(3)),
      },
      strength: Math.min(1, recurrence.similarity + 0.2),
    });
  }

  if (reinforcement && reinforcement !== recurrence) {
    drafts.push({
      type: InsightType.REINFORCES,
      headline: voice.reinforces(reinforcement.title),
      body: `This capture shares significant topic overlap and similar language with "${reinforcement.title}" (topic overlap ${Number(reinforcement.topicJaccard.toFixed(2))}, similarity ${Number(reinforcement.similarity.toFixed(2))}). Reinforcing evidence can strengthen a conviction — but it can also create an echo. Consider whether you are encountering genuinely new support or the same idea in a different package.`,
      evidence: {
        capturedItemId: reinforcement.capturedItemId,
        similarity: Number(reinforcement.similarity.toFixed(3)),
        topicJaccard: Number(reinforcement.topicJaccard.toFixed(3)),
      },
      strength: reinforcement.similarity,
    });
  }

  if (contradiction) {
    drafts.push({
      type: InsightType.CONTRADICTS,
      headline: voice.contradicts(contradiction.title),
      body: `This capture shares topics with "${contradiction.title}" but uses meaningfully different language and framing (polarity divergence detected). These two items are pulling in different directions within the same intellectual territory. That tension is worth examining — contradictions in your reading often mark the boundary of a real open question.`,
      evidence: {
        capturedItemId: contradiction.capturedItemId,
        similarity: Number(contradiction.similarity.toFixed(3)),
        topicJaccard: Number(contradiction.topicJaccard.toFixed(3)),
      },
      strength: 0.5 + contradiction.topicJaccard / 2,
    });
  }

  const dominantCount = args.topicCounts.find((entry) => entry.name === dominantTopic);

  // Repetition fatigue for the volume/direction readings. These derive from
  // the whole account, not this capture, so every capture in a burst produces
  // essentially the same one — the batch test run led ~30 of 57 captures with
  // "your attention is shifting toward X". Once a type has led twice in the
  // recent run it is fatigued: harder to trigger and heavily discounted, so
  // concrete per-capture evidence (recur/reinforce/contradict) wins instead.
  const repeatCount = (t: InsightType) =>
    (args.recentInsightTypes ?? []).filter((x) => x === t).length;
  const trajectoryFatigued = repeatCount(InsightType.TRAJECTORY) >= 2;
  const patternFatigued = repeatCount(InsightType.PATTERN) >= 2;

  const patternDraft: InsightDraft | null = dominantCount && dominantCount.count >= 3
    ? {
      type: InsightType.PATTERN,
      headline: voice.pattern(dominantCount.count, dominantCount.name),
      body: `You have returned to ${dominantCount.name} ${dominantCount.count} times across your saved items — a clear sustained interest. Repeated engagement with a topic is often the precursor to genuine expertise or a crystallised point of view. It may be worth asking: what is the unresolved question that keeps drawing you back here?`,
      evidence: {
        topicId: dominantCount.topicId,
        topic: dominantCount.name,
        count: dominantCount.count,
      },
      strength: Math.min(1, 0.4 + dominantCount.count / 12) * (patternFatigued ? 0.5 : 1),
    }
    : null;

  // Delta >= 2: a one-capture "shift" is noise — any two saves on a topic in
  // a week read as a trajectory under the old >= 1 gate. Fatigue raises the
  // bar further: only a genuinely large swing resurfaces the reading.
  const trajectoryGate = trajectoryFatigued ? 4 : 2;
  const trajectoryDraft: InsightDraft | null = args.shift && Math.abs(args.shift.delta) >= trajectoryGate
    ? {
      type: InsightType.TRAJECTORY,
      headline: args.shift.delta > 0 ? voice.trajectoryUp(args.shift.name) : voice.trajectoryDown(args.shift.name),
      body: `Your attention on ${args.shift.name} is ${args.shift.delta > 0 ? "rising" : "declining"}: ${args.shift.recentCount} captures in the recent window versus ${args.shift.priorCount} in the prior period (delta ${args.shift.delta > 0 ? "+" : ""}${args.shift.delta}). Trajectory shifts often precede a period of consolidation or a pivot. Whether this is deliberate or a drift is worth noticing.`,
      evidence: args.shift,
      strength: Math.min(1, Math.abs(args.shift.delta) / 5 + 0.3) * (trajectoryFatigued ? 0.5 : 1),
    }
    : null;

  // Both read as "you keep engaging with X" when they name the SAME topic —
  // volume and direction of the one interest. Emit only the stronger of the
  // two. When they name different topics they say genuinely different things,
  // so both stand.
  const sameTopic =
    patternDraft !== null &&
    trajectoryDraft !== null &&
    args.shift!.topicId === dominantCount!.topicId;

  if (sameTopic) {
    drafts.push(trajectoryDraft!.strength > patternDraft!.strength ? trajectoryDraft! : patternDraft!);
  } else {
    if (patternDraft) drafts.push(patternDraft);
    if (trajectoryDraft) drafts.push(trajectoryDraft);
  }

  if (args.topNeighbors.length > 0 && drafts.length < 2) {
    const neighborTitles = args.topNeighbors.slice(0, 2).map((n) => `"${n.title}"`).join(" and ");
    drafts.push({
      type: InsightType.CONNECTION,
      headline: voice.connection(args.topNeighbors.slice(0, 2).map((n) => n.title)),
      body: `This capture is most closely connected to ${neighborTitles} in your memory graph. These connections are based on shared topics and semantic similarity — they form a cluster of related thinking. Reviewing them together may surface a synthesis you haven't articulated yet.`,
      evidence: {
        neighbors: args.topNeighbors.slice(0, 3).map((n) => ({
          capturedItemId: n.capturedItemId,
          similarity: Number(n.similarity.toFixed(3)),
          edgeType: n.edgeType,
        })),
      },
      strength: args.topNeighbors[0].similarity,
    });
  }

  // Thin captures with no real neighbor signal get no insight rather than
  // app-describing boilerplate — a wrong insight is worse than none.
  if (drafts.length === 0 && !args.contentThin) {
    drafts.push({
      type: InsightType.NOVELTY,
      headline: voice.novelty(dominantTopic),
      body: dominantTopic
        ? `Nothing in your existing record closely matches this under ${dominantTopic}. That makes it a genuine new signal — a first data point in a direction your thinking hasn't gone before. Save more on this topic and the graph will start to show you where it connects.`
        : "Nothing in your existing record closely matches this capture. It stands alone for now — a first node in a new region of your graph. As you add more, the system will find the threads that connect it to what you already know.",
      evidence: { dominantTopic },
      strength: 0.6,
    });
  }

  // Cap how many insights a single capture yields. Emitting one per signal
  // (recur + reinforce + contradict + pattern + trajectory) overwhelms the
  // reader and wastes tokens polishing them. Keep the two strongest, and a
  // third only when it clears a higher bar (a genuinely strong extra signal).
  const REGULAR_INSIGHTS = 2;
  const THIRD_INSIGHT_MIN_STRENGTH = 0.6;
  drafts.sort((a, b) => b.strength - a.strength);
  const selected = drafts.slice(0, REGULAR_INSIGHTS);
  const third = drafts[REGULAR_INSIGHTS];
  if (third && third.strength >= THIRD_INSIGHT_MIN_STRENGTH) {
    selected.push(third);
  }
  return selected;
}

/**
 * Edge classification driven by EMBEDDING cosine similarity rather than
 * keyword overlap. text-embedding-3 similarities run roughly: ~0.6+ very
 * close / recurring, ~0.45–0.6 strongly related, ~0.32–0.45 related,
 * <~0.30 unrelated. An edge is only created above CONNECT (0.30) so genuinely
 * unrelated captures never connect.
 */
export const SEMANTIC_CONNECT_THRESHOLD = 0.3;

/**
 * The bar for a neighbor to be worth *naming* as a connected memory, and the
 * most we will name. An edge above SEMANTIC_CONNECT_THRESHOLD is real enough to
 * draw on the Atlas, but far too loose to headline: a capture accrues an edge
 * from every later capture that picks it as a neighbor, so a long-lived node
 * ends up with many more edges than the six it created and the list degenerates
 * into "everything I ever saved". Require the "strongly related" band (>=0.45,
 * where REINFORCES begins) and keep at most the three strongest.
 */
export const RELATED_MIN_WEIGHT = 0.45;
export const RELATED_LIMIT = 3;

export function classifyEdgeSemantic(args: {
  similarity: number;
  polarityDelta: number;
  topicJaccard: number;
}): MemoryEdgeType | null {
  const { similarity, polarityDelta, topicJaccard } = args;

  if (similarity < SEMANTIC_CONNECT_THRESHOLD) {
    return null;
  }

  // Related in meaning but genuinely diverging stance → contradiction. All
  // three signals are required: the old gate (similarity >= 0.34, delta >=
  // 0.05, no topic requirement, checked before RECURS) read mild stylistic
  // variance between loosely related items as "this weakens an earlier
  // belief" — e.g. Hero's Journey contradicting an essay on doing great work.
  // The band is capped below RECURS territory so near-identical content is
  // recurrence, not contradiction; Mind's tension region also has the LLM
  // topic-tension scan, so it doesn't rely on this heuristic alone.
  if (similarity >= 0.40 && similarity < 0.62 && topicJaccard >= 0.15 && polarityDelta >= 0.12) {
    return MemoryEdgeType.CONTRADICTS;
  }

  // Same idea seen repeatedly (very high similarity, shared topics).
  if (similarity >= 0.62 || (similarity >= 0.55 && topicJaccard >= 0.5)) {
    return MemoryEdgeType.RECURS;
  }

  if (similarity >= 0.45) {
    return MemoryEdgeType.REINFORCES;
  }

  if (similarity >= 0.36) {
    return MemoryEdgeType.EVOLVES_FROM;
  }

  return MemoryEdgeType.RELATED;
}

export function classifyEdge(args: {
  cosine: number;
  topicJaccard: number;
  polarityDelta: number;
}): MemoryEdgeType | null {
  if (args.topicJaccard >= 0.5 && args.cosine >= 0.45) {
    return MemoryEdgeType.RECURS;
  }

  if (args.topicJaccard >= 0.3 && args.cosine >= 0.25 && args.polarityDelta < 0.08) {
    return MemoryEdgeType.REINFORCES;
  }

  if (args.topicJaccard >= 0.3 && args.polarityDelta >= 0.08) {
    return MemoryEdgeType.CONTRADICTS;
  }

  if (args.topicJaccard >= 0.15 && args.cosine >= 0.12) {
    return MemoryEdgeType.EVOLVES_FROM;
  }

  if (args.cosine >= 0.1 || args.topicJaccard >= 0.15) {
    return MemoryEdgeType.RELATED;
  }

  return null;
}
