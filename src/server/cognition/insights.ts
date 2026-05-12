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
}): InsightDraft[] {
  const drafts: InsightDraft[] = [];
  const voice = STYLE_VOICE[args.style];
  const dominantTopic = args.topicNames[0];

  if (args.isFirstCapture) {
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

  if (dominantCount && dominantCount.count >= 3) {
    drafts.push({
      type: InsightType.PATTERN,
      headline: voice.pattern(dominantCount.count, dominantCount.name),
      body: `You have returned to ${dominantCount.name} ${dominantCount.count} times across your saved items — a clear sustained interest. Repeated engagement with a topic is often the precursor to genuine expertise or a crystallised point of view. It may be worth asking: what is the unresolved question that keeps drawing you back here?`,
      evidence: {
        topicId: dominantCount.topicId,
        topic: dominantCount.name,
        count: dominantCount.count,
      },
      strength: Math.min(1, 0.4 + dominantCount.count / 12),
    });
  }

  if (args.shift && Math.abs(args.shift.delta) >= 1) {
    const direction = args.shift.delta > 0 ? "rising" : "declining";
    drafts.push({
      type: InsightType.TRAJECTORY,
      headline: args.shift.delta > 0 ? voice.trajectoryUp(args.shift.name) : voice.trajectoryDown(args.shift.name),
      body: `Your attention on ${args.shift.name} is ${direction}: ${args.shift.recentCount} captures in the recent window versus ${args.shift.priorCount} in the prior period (delta ${args.shift.delta > 0 ? "+" : ""}${args.shift.delta}). Trajectory shifts often precede a period of consolidation or a pivot. Whether this is deliberate or a drift is worth noticing.`,
      evidence: args.shift,
      strength: Math.min(1, Math.abs(args.shift.delta) / 5 + 0.3),
    });
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

  if (drafts.length === 0) {
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

  return drafts;
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
