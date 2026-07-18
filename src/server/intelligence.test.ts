import { afterEach, describe, expect, it, vi } from "vitest";
import {
  generateContradictionTension,
  generateThreadSynthesis,
  generateConvergenceSignal,
} from "@/server/cognition/llm";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ── generateContradictionTension ─────────────────────────────────────────────

describe("generateContradictionTension", () => {
  it("returns null when OPENAI_API_KEY is not set", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const result = await generateContradictionTension({
      labelA: "A", textA: "text A", labelB: "B", textB: "text B",
    });
    expect(result).toBeNull();
  });

  it("returns the insight from a valid API response", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              tension: "A holds X while B holds Y.",
              crux: "Does X survive Y?",
              test: "Write one paragraph defending X against Y.",
            }),
          },
        }],
      }),
    }));
    const result = await generateContradictionTension({
      labelA: "A", textA: "text A", labelB: "B", textB: "text B",
    });
    expect(result).toEqual({
      tension: "A holds X while B holds Y.",
      crux: "Does X survive Y?",
      test: "Write one paragraph defending X against Y.",
    });
  });

  it("returns null crux/test when the model omits them", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ tension: "A holds X while B holds Y." }) } }],
      }),
    }));
    const result = await generateContradictionTension({
      labelA: "A", textA: "text A", labelB: "B", textB: "text B",
    });
    expect(result).toEqual({ tension: "A holds X while B holds Y.", crux: null, test: null });
  });

  it("returns null when API response is not ok", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    const result = await generateContradictionTension({
      labelA: "A", textA: "", labelB: "B", textB: "",
    });
    expect(result).toBeNull();
  });

  it("returns null when tension field is missing", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({ other: "field" }) } }] }),
    }));
    const result = await generateContradictionTension({
      labelA: "A", textA: "", labelB: "B", textB: "",
    });
    expect(result).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));
    const result = await generateContradictionTension({
      labelA: "A", textA: "", labelB: "B", textB: "",
    });
    expect(result).toBeNull();
  });
});

// ── generateThreadSynthesis ───────────────────────────────────────────────────

describe("generateThreadSynthesis", () => {
  const fiveCaptures = Array.from({ length: 5 }, (_, i) => ({
    label: `Capture ${i}`,
    keyIdea: `idea ${i}`,
    text: `text ${i}`,
  }));

  it("returns null when OPENAI_API_KEY is not set", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const result = await generateThreadSynthesis({
      topicName: "consciousness", captures: fiveCaptures,
    });
    expect(result).toBeNull();
  });

  it("returns null when fewer than 5 captures are provided", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const result = await generateThreadSynthesis({
      topicName: "consciousness",
      captures: fiveCaptures.slice(0, 4),
    });
    expect(result).toBeNull();
  });

  it("returns position and openQuestion from a valid API response", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              position: "You appear to believe consciousness is irreducible.",
              open_question: "Does irreducibility imply substance dualism or merely explanatory gap?",
            }),
          },
        }],
      }),
    }));
    const result = await generateThreadSynthesis({
      topicName: "consciousness", captures: fiveCaptures,
    });
    expect(result).toEqual({
      position: "You appear to believe consciousness is irreducible.",
      openQuestion: "Does irreducibility imply substance dualism or merely explanatory gap?",
    });
  });

  it("returns null when position or open_question is missing", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ position: "Only position, no question." }) } }],
      }),
    }));
    const result = await generateThreadSynthesis({
      topicName: "consciousness", captures: fiveCaptures,
    });
    expect(result).toBeNull();
  });
});

// ── generateConvergenceSignal ─────────────────────────────────────────────────

describe("generateConvergenceSignal", () => {
  const diverseCaptures = [
    { label: "A", source: "The Atlantic", keyIdea: "idea A" },
    { label: "B", source: "Stanford Encyclopedia", keyIdea: "idea B" },
    { label: "C", source: "Nature", keyIdea: "idea C" },
  ];

  it("returns null when OPENAI_API_KEY is not set", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const result = await generateConvergenceSignal({
      topicName: "free will", captures: diverseCaptures,
    });
    expect(result).toBeNull();
  });

  it("returns the insight from a valid API response", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              signal: "From physics, philosophy, and literature you keep landing on: agency requires indeterminacy.",
              arrival: "agency requires indeterminacy",
              act: "Re-read A and C side by side.",
            }),
          },
        }],
      }),
    }));
    const result = await generateConvergenceSignal({
      topicName: "free will", captures: diverseCaptures,
    });
    expect(result).toEqual({
      signal: "From physics, philosophy, and literature you keep landing on: agency requires indeterminacy.",
      arrival: "agency requires indeterminacy",
      act: "Re-read A and C side by side.",
    });
  });

  it("returns null when signal field is missing", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({ other: "field" }) } }] }),
    }));
    const result = await generateConvergenceSignal({
      topicName: "free will", captures: diverseCaptures,
    });
    expect(result).toBeNull();
  });
});

import {
  groupCapturesByTopic,
  findDormantThreads,
  findConvergenceCandidates,
  diversifyGroups,
  type LoadedCapture,
  type TopicGroup,
} from "@/server/services/intelligence";

function makeCapture(overrides: Partial<LoadedCapture> & { topics: LoadedCapture["topics"] }): LoadedCapture {
  return {
    id: overrides.id ?? "c1",
    label: overrides.label ?? "Untitled",
    rawText: overrides.rawText ?? null,
    gist: overrides.gist ?? overrides.rawText ?? "",
    keyIdea: overrides.keyIdea ?? null,
    capturedAt: overrides.capturedAt ?? new Date("2026-01-15"),
    sourceName: overrides.sourceName ?? null,
    topics: overrides.topics,
  };
}

// ── groupCapturesByTopic ──────────────────────────────────────────────────────

describe("groupCapturesByTopic", () => {
  it("returns empty when captures is empty", () => {
    expect(groupCapturesByTopic([], 1)).toEqual([]);
  });

  it("returns empty when no group meets minCount", () => {
    const captures = [
      makeCapture({ id: "c1", topics: [{ topicId: "t1", name: "philosophy" }] }),
    ];
    expect(groupCapturesByTopic(captures, 2)).toEqual([]);
  });

  it("groups captures by topic correctly", () => {
    const captures = [
      makeCapture({ id: "c1", topics: [{ topicId: "t1", name: "philosophy" }] }),
      makeCapture({ id: "c2", topics: [{ topicId: "t1", name: "philosophy" }] }),
    ];
    const result = groupCapturesByTopic(captures, 2);
    expect(result).toHaveLength(1);
    expect(result[0].topicId).toBe("t1");
    expect(result[0].captures).toHaveLength(2);
  });

  it("a capture with multiple topics appears in each topic group", () => {
    const captures = [
      makeCapture({ id: "c1", topics: [{ topicId: "t1", name: "philosophy" }, { topicId: "t2", name: "ethics" }] }),
      makeCapture({ id: "c2", topics: [{ topicId: "t1", name: "philosophy" }] }),
    ];
    const result = groupCapturesByTopic(captures, 1);
    const t1 = result.find((g) => g.topicId === "t1");
    const t2 = result.find((g) => g.topicId === "t2");
    expect(t1?.captures).toHaveLength(2);
    expect(t2?.captures).toHaveLength(1);
  });

  it("sorts groups by capture count descending", () => {
    const captures = [
      makeCapture({ id: "c1", topics: [{ topicId: "t2", name: "ethics" }] }),
      makeCapture({ id: "c2", topics: [{ topicId: "t1", name: "philosophy" }] }),
      makeCapture({ id: "c3", topics: [{ topicId: "t1", name: "philosophy" }] }),
      makeCapture({ id: "c4", topics: [{ topicId: "t1", name: "philosophy" }] }),
    ];
    const result = groupCapturesByTopic(captures, 1);
    expect(result[0].topicId).toBe("t1");
    expect(result[1].topicId).toBe("t2");
  });
});

// ── findDormantThreads ────────────────────────────────────────────────────────

describe("findDormantThreads", () => {
  const now = new Date("2026-06-10T12:00:00Z");

  function makeGroup(topicId: string, captureDates: string[]): TopicGroup {
    return {
      topicId,
      topicName: `Topic ${topicId}`,
      captures: captureDates.map((d, i) =>
        makeCapture({
          id: `${topicId}-${i}`,
          capturedAt: new Date(d),
          topics: [{ topicId, name: `Topic ${topicId}` }],
        }),
      ),
    };
  }

  it("returns empty when no groups are dormant", () => {
    const groups = [makeGroup("t1", ["2026-06-08", "2026-06-07", "2026-06-06"])];
    expect(findDormantThreads(groups, now)).toEqual([]);
  });

  it("returns a dormant thread when last capture is >21 days ago", () => {
    const groups = [makeGroup("t1", ["2026-05-01", "2026-04-15", "2026-04-10"])];
    const result = findDormantThreads(groups, now);
    expect(result).toHaveLength(1);
    expect(result[0].topicId).toBe("t1");
    expect(result[0].daysSilent).toBe(40);
  });

  it("excludes groups with fewer than 2 captures", () => {
    const groups = [makeGroup("t1", ["2026-04-01"])];
    expect(findDormantThreads(groups, now)).toEqual([]);
  });

  it("sorts dormant threads by captureCount descending", () => {
    const groups = [
      makeGroup("t1", ["2026-04-01", "2026-03-01", "2026-02-01"]),
      makeGroup("t2", ["2026-04-01", "2026-03-01", "2026-02-01", "2026-01-01", "2026-01-01"]),
    ];
    const result = findDormantThreads(groups, now);
    expect(result[0].topicId).toBe("t2");
  });

  it("returns at most 4 dormant threads", () => {
    const groups = Array.from({ length: 6 }, (_, i) =>
      makeGroup(`t${i}`, ["2026-04-01", "2026-03-01", "2026-02-01"]),
    );
    expect(findDormantThreads(groups, now).length).toBeLessThanOrEqual(4);
  });
});

// ── findConvergenceCandidates ─────────────────────────────────────────────────

describe("findConvergenceCandidates", () => {
  it("returns empty when a group has only one distinct source", () => {
    const groups: TopicGroup[] = [{
      topicId: "t1",
      topicName: "philosophy",
      captures: [
        makeCapture({ id: "c1", sourceName: "Atlantic", topics: [{ topicId: "t1", name: "philosophy" }] }),
        makeCapture({ id: "c2", sourceName: "Atlantic", topics: [{ topicId: "t1", name: "philosophy" }] }),
      ],
    }];
    expect(findConvergenceCandidates(groups)).toEqual([]);
  });

  it("returns groups with 2+ distinct source names", () => {
    const groups: TopicGroup[] = [{
      topicId: "t2",
      topicName: "ethics",
      captures: [
        makeCapture({ id: "d1", sourceName: "Atlantic", topics: [{ topicId: "t2", name: "ethics" }] }),
        makeCapture({ id: "d2", sourceName: "Nature", topics: [{ topicId: "t2", name: "ethics" }] }),
      ],
    }];
    expect(findConvergenceCandidates(groups)).toHaveLength(1);
  });

  it("returns groups with 3+ distinct source names", () => {
    const groups: TopicGroup[] = [{
      topicId: "t1",
      topicName: "philosophy",
      captures: [
        makeCapture({ id: "c1", sourceName: "Atlantic", topics: [{ topicId: "t1", name: "philosophy" }] }),
        makeCapture({ id: "c2", sourceName: "Stanford SEP", topics: [{ topicId: "t1", name: "philosophy" }] }),
        makeCapture({ id: "c3", sourceName: "Nature", topics: [{ topicId: "t1", name: "philosophy" }] }),
      ],
    }];
    expect(findConvergenceCandidates(groups)).toHaveLength(1);
  });

  it("treats null sourceName as one shared 'unknown' source", () => {
    const groups: TopicGroup[] = [{
      topicId: "t1",
      topicName: "philosophy",
      captures: [
        makeCapture({ id: "c1", sourceName: null, topics: [{ topicId: "t1", name: "philosophy" }] }),
        makeCapture({ id: "c2", sourceName: null, topics: [{ topicId: "t1", name: "philosophy" }] }),
        makeCapture({ id: "c3", sourceName: null, topics: [{ topicId: "t1", name: "philosophy" }] }),
      ],
    }];
    expect(findConvergenceCandidates(groups)).toEqual([]);
  });
});

// ── diversifyGroups ───────────────────────────────────────────────────────────

describe("diversifyGroups", () => {
  const topics = (id: string, name: string) => [{ topicId: id, name }];

  it("skips a group whose captures mostly duplicate an already-picked group", () => {
    const shared = [
      makeCapture({ id: "c1", topics: topics("t1", "philosophy") }),
      makeCapture({ id: "c2", topics: topics("t1", "philosophy") }),
      makeCapture({ id: "c3", topics: topics("t1", "philosophy") }),
    ];
    const groups: TopicGroup[] = [
      { topicId: "t1", topicName: "philosophy", captures: shared },
      { topicId: "t2", topicName: "consciousness", captures: shared.slice(0, 2) },
      {
        topicId: "t3",
        topicName: "economics",
        captures: [
          makeCapture({ id: "c9", topics: topics("t3", "economics") }),
          makeCapture({ id: "c10", topics: topics("t3", "economics") }),
        ],
      },
    ];
    const picked = diversifyGroups(groups, 3);
    expect(picked.map((g) => g.topicId)).toEqual(["t1", "t3"]);
  });

  it("keeps groups with light overlap and respects the limit", () => {
    const groups: TopicGroup[] = [
      {
        topicId: "t1", topicName: "a",
        captures: [
          makeCapture({ id: "c1", topics: topics("t1", "a") }),
          makeCapture({ id: "c2", topics: topics("t1", "a") }),
          makeCapture({ id: "c3", topics: topics("t1", "a") }),
        ],
      },
      {
        topicId: "t2", topicName: "b",
        captures: [
          makeCapture({ id: "c3", topics: topics("t2", "b") }),
          makeCapture({ id: "c4", topics: topics("t2", "b") }),
          makeCapture({ id: "c5", topics: topics("t2", "b") }),
        ],
      },
      {
        topicId: "t3", topicName: "c",
        captures: [
          makeCapture({ id: "c6", topics: topics("t3", "c") }),
          makeCapture({ id: "c7", topics: topics("t3", "c") }),
        ],
      },
    ];
    expect(diversifyGroups(groups, 2).map((g) => g.topicId)).toEqual(["t1", "t2"]);
  });
});
