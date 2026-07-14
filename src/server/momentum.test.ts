import { describe, expect, it } from "vitest";
import { pickRisingTopic, rankTopicMomentum } from "@/server/services/memory";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-07-13T12:00:00Z").getTime();
const WEEK_WINDOW = { recentDays: 7, priorDays: 30, now: NOW };

/** `n` captures of one topic, spread evenly between `fromDaysAgo` and `toDaysAgo`. */
function captures(topicId: string, name: string, n: number, fromDaysAgo: number, toDaysAgo: number) {
  const span = fromDaysAgo - toDaysAgo;
  return Array.from({ length: n }, (_, i) => ({
    capturedAt: new Date(NOW - (fromDaysAgo - (span * i) / Math.max(1, n - 1)) * DAY_MS),
    topics: [{ topicId, name }],
  }));
}

describe("rankTopicMomentum", () => {
  it("ranks a small topic that just woke up above a big one ticking along", () => {
    // The reported bug: 4 fresh philosophy captures were outranked by AI, which
    // had a bigger raw delta purely because it was already the largest topic.
    const items = [
      ...captures("ai", "ai", 12, 6.5, 0.5), // 12 this week
      ...captures("ai", "ai", 8, 22, 8), // 8 in the prior window
      ...captures("phil", "philosophy", 4, 1, 0), // 4, all today-ish, no history
    ];

    const ranked = rankTopicMomentum(items, WEEK_WINDOW);

    expect(ranked[0]?.topicId).toBe("phil");
    expect(ranked[0]!.lift).toBeGreaterThan(ranked[1]!.lift);
    // Raw delta would have said otherwise — AI's is +4, philosophy's is +4, and
    // AI wins that tie on volume. That is the bias being corrected.
    expect(ranked.find((t) => t.topicId === "ai")!.recent).toBe(12);
  });

  it("excludes a topic below the recent-capture floor", () => {
    const items = [...captures("solo", "solo", 1, 0.5, 0.5), ...captures("real", "real", 3, 2, 0)];

    const ranked = rankTopicMomentum(items, WEEK_WINDOW);

    expect(ranked.map((t) => t.topicId)).toEqual(["real"]);
  });

  it("gives a topic with no prior history a finite lift", () => {
    const ranked = rankTopicMomentum(captures("new", "new", 3, 2, 0), WEEK_WINDOW);

    expect(ranked).toHaveLength(1);
    expect(Number.isFinite(ranked[0]!.lift)).toBe(true);
    expect(ranked[0]!.lift).toBeGreaterThan(1);
  });

  it("breaks ties on recency, not on total volume", () => {
    // Identical rates — so identical lift. The bigger topic must not win.
    const items = [
      ...captures("big", "big", 4, 6, 3),
      ...captures("big", "big", 10, 22, 8),
      ...captures("small", "small", 4, 3, 0.1),
      ...captures("small", "small", 10, 22, 8),
    ];

    const ranked = rankTopicMomentum(items, WEEK_WINDOW);

    expect(ranked[0]!.lift).toBeCloseTo(ranked[1]!.lift, 10);
    expect(ranked[0]!.topicId).toBe("small");
  });

  it("ignores captures older than the prior window", () => {
    const items = [...captures("old", "old", 20, 200, 40), ...captures("now", "now", 2, 1, 0)];

    const ranked = rankTopicMomentum(items, WEEK_WINDOW);

    expect(ranked.map((t) => t.topicId)).toEqual(["now"]);
  });

  it("returns nothing for no captures", () => {
    expect(rankTopicMomentum([], WEEK_WINDOW)).toEqual([]);
  });
});

describe("pickRisingTopic", () => {
  it("names the accelerating topic", () => {
    const items = [
      ...captures("ai", "ai", 12, 6.5, 0.5),
      ...captures("ai", "ai", 8, 22, 8),
      ...captures("phil", "philosophy", 4, 1, 0),
    ];

    expect(pickRisingTopic(items, WEEK_WINDOW)).toEqual({ topicId: "phil", name: "philosophy" });
  });

  it("is null when a topic is steady rather than rising", () => {
    // Same per-day rate before and after — steady, so nothing is "rising".
    const items = [...captures("steady", "steady", 7, 6.9, 0.1), ...captures("steady", "steady", 23, 22.9, 7.1)];

    expect(pickRisingTopic(items, WEEK_WINDOW)).toBeNull();
  });

  it("is null when nothing clears the recent-capture floor", () => {
    expect(pickRisingTopic(captures("solo", "solo", 1, 1, 1), WEEK_WINDOW)).toBeNull();
  });
});
