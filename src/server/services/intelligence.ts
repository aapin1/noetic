const DORMANT_ACTIVE_MIN = 3;
const DORMANT_SILENT_DAYS = 21;
const CONVERGENCE_SOURCE_MIN = 3;

export type LoadedCapture = {
  id: string;
  label: string;
  rawText: string | null;
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

export type ContradictionCard = {
  itemAId: string;
  itemBId: string;
  labelA: string;
  labelB: string;
  previewA: string;
  previewB: string;
  tension: string;
};

export type ThreadSynthesis = {
  topicId: string;
  topicName: string;
  captureCount: number;
  position: string;
  openQuestion: string;
};

export type ConvergenceSignal = {
  topicId: string;
  topicName: string;
  captureCount: number;
  sourceCount: number;
  signal: string;
};

export type EvolutionPeriod = {
  month: string;
  captureCount: number;
  keyIdeas: string[];
};

export type EvolutionArc = {
  topicId: string;
  topicName: string;
  captureCount: number;
  periods: EvolutionPeriod[];
};

export type DormantThread = {
  topicId: string;
  topicName: string;
  captureCount: number;
  lastCapturedAt: string;
  daysSilent: number;
};

export type PersonalIntelligenceData = {
  contradictionCards: ContradictionCard[];
  threadSyntheses: ThreadSynthesis[];
  convergenceSignals: ConvergenceSignal[];
  evolutionArcs: EvolutionArc[];
  dormantThreads: DormantThread[];
};

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

  return result.sort((a, b) => b.captureCount - a.captureCount).slice(0, 3);
}

export function buildEvolutionArc(group: TopicGroup): EvolutionArc {
  const byMonth = new Map<string, LoadedCapture[]>();
  for (const capture of group.captures) {
    const month = capture.capturedAt.toISOString().slice(0, 7);
    const list = byMonth.get(month) ?? [];
    list.push(capture);
    byMonth.set(month, list);
  }

  const periods: EvolutionPeriod[] = Array.from(byMonth.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, items]) => ({
      month,
      captureCount: items.length,
      keyIdeas: items
        .filter((i) => i.keyIdea)
        .map((i) => i.keyIdea as string)
        .slice(0, 3),
    }));

  return {
    topicId: group.topicId,
    topicName: group.topicName,
    captureCount: group.captures.length,
    periods,
  };
}

export function findConvergenceCandidates(topicGroups: TopicGroup[]): TopicGroup[] {
  return topicGroups.filter((group) => {
    const sources = new Set(group.captures.map((c) => c.sourceName ?? "__unknown__"));
    return sources.size >= CONVERGENCE_SOURCE_MIN;
  });
}
