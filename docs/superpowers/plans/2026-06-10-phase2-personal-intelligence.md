# Phase 2 — Personal Intelligence Engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Personal Intelligence Engine — a new `GET /api/memory/intelligence` endpoint and a "Mind" tab in the mobile app that surfaces contradiction cards, thread syntheses, convergence signals, evolution arcs, and dormant thread nudges.

**Architecture:** Two DB queries (captures + CONTRADICTS edges) feed up to 6 parallel LLM calls; all failures degrade gracefully to empty arrays. Pure helper functions do the in-memory aggregation (grouping by topic, dormant detection, evolution bucketing, convergence filtering) and are tested directly. A new "Mind" tab renders each non-empty section.

**Tech Stack:** TypeScript, Prisma 5, Next.js 14 App Router, OpenAI via raw fetch, React Native/Expo 51, expo-router.

---

## File Map

| Status | Path | Purpose |
|--------|------|---------|
| Create | `src/server/intelligence.test.ts` | Unit tests for LLM functions and pure helpers |
| Modify | `src/server/cognition/llm.ts` | Add `generateContradictionTension`, `generateThreadSynthesis`, `generateConvergenceSignal` |
| Create | `src/server/services/intelligence.ts` | Types, pure helpers, `getPersonalIntelligence` orchestrator |
| Create | `src/app/api/memory/intelligence/route.ts` | GET handler |
| Modify | `mobile/types/api.ts` | Add 7 Phase 2 response types |
| Modify | `mobile/lib/api.ts` | Add `api.memory.intelligence()` |
| Create | `mobile/app/(tabs)/mind.tsx` | Mind tab screen |
| Modify | `mobile/app/(tabs)/_layout.tsx` | Register Mind tab |

---

## Task 1: LLM functions for personal intelligence

**Files:**
- Create: `src/server/intelligence.test.ts`
- Modify: `src/server/cognition/llm.ts`

- [ ] **Step 1.1: Write failing tests for the 3 LLM functions**

Create `src/server/intelligence.test.ts`:

```typescript
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

  it("returns the tension string from a valid API response", async () => {
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
    expect(result).toBe("A holds X while B holds Y.");
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

  it("returns the signal string from a valid API response", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ signal: "From physics, philosophy, and literature you keep landing on: agency requires indeterminacy." }) } }],
      }),
    }));
    const result = await generateConvergenceSignal({
      topicName: "free will", captures: diverseCaptures,
    });
    expect(result).toBe("From physics, philosophy, and literature you keep landing on: agency requires indeterminacy.");
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
```

- [ ] **Step 1.2: Run tests to verify they fail**

```bash
npx vitest run src/server/intelligence.test.ts
```

Expected: FAIL with "generateContradictionTension is not a function" (or similar export error).

- [ ] **Step 1.3: Add `generateContradictionTension` to `src/server/cognition/llm.ts`**

Append after the existing `generateRecommendations` function:

```typescript
export async function generateContradictionTension(args: {
  labelA: string;
  textA: string;
  labelB: string;
  textB: string;
}): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const systemPrompt = [
    "Two saved captures appear to hold opposing positions on the same question.",
    "Name the specific intellectual tension between them in 1-2 sentences.",
    "Requirements:",
    "- Name the exact claim in conflict, not the general topic area.",
    "- Bad: 'These items disagree about free will.' Good: 'Item A grounds moral responsibility in the causal structure of neural events, while Item B holds that uncompelled choice is a necessary condition for culpability — the disagreement turns on whether causal inevitability eliminates genuine agency.'",
    "- Do not start with 'These captures' or 'These items'.",
    "Return strictly valid JSON (no markdown): {\"tension\": \"...\"}",
  ].join("\n");

  try {
    const response = await fetch(OPENAI_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: JSON.stringify({
              item_a: { title: args.labelA, text: args.textA.slice(0, 800) },
              item_b: { title: args.labelB, text: args.textB.slice(0, 800) },
            }),
          },
        ],
      }),
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = payload.choices?.[0]?.message?.content;
    if (!raw) return null;

    const parsed = JSON.parse(raw) as { tension?: unknown };
    if (typeof parsed.tension !== "string" || parsed.tension.trim().length === 0) return null;

    return parsed.tension.trim();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 1.4: Add `generateThreadSynthesis` to `src/server/cognition/llm.ts`**

Append after `generateContradictionTension`:

```typescript
export async function generateThreadSynthesis(args: {
  topicName: string;
  captures: { label: string; keyIdea: string | null; text: string }[];
}): Promise<{ position: string; openQuestion: string } | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  if (args.captures.length < 5) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const systemPrompt = [
    "A user has been circling the same topic from multiple angles.",
    "Based on what they've saved, state where their thinking appears to have landed — not a summary of what they read, but a claim about what they seem to believe.",
    "",
    "POSITION rules:",
    "- One sentence. A specific intellectual claim, not a category description.",
    "- Bad: 'The user has explored consciousness from many angles.' Good: 'The pattern suggests you hold that subjective experience is not reducible to physical processes, though you remain uncertain about what that irreducibility implies.'",
    "- Address the user directly as 'you'.",
    "",
    "OPEN_QUESTION rules:",
    "- One question the user hasn't yet asked themselves but that follows naturally from this position.",
    "- Should feel generative — answerable with more thought or research.",
    "",
    "Return strictly valid JSON (no markdown): {\"position\": \"...\", \"open_question\": \"...\"}",
  ].join("\n");

  try {
    const response = await fetch(OPENAI_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: JSON.stringify({
              topic: args.topicName,
              captures: args.captures.map((c) => ({
                title: c.label,
                key_idea: c.keyIdea ?? "",
                excerpt: c.text.slice(0, 400),
              })),
            }),
          },
        ],
      }),
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = payload.choices?.[0]?.message?.content;
    if (!raw) return null;

    const parsed = JSON.parse(raw) as { position?: unknown; open_question?: unknown };
    if (
      typeof parsed.position !== "string" || parsed.position.trim().length === 0 ||
      typeof parsed.open_question !== "string" || parsed.open_question.trim().length === 0
    ) return null;

    return {
      position: parsed.position.trim(),
      openQuestion: parsed.open_question.trim(),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 1.5: Add `generateConvergenceSignal` to `src/server/cognition/llm.ts`**

Append after `generateThreadSynthesis`:

```typescript
export async function generateConvergenceSignal(args: {
  topicName: string;
  captures: { label: string; source: string | null; keyIdea: string | null }[];
}): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const systemPrompt = [
    "A user has arrived at the same intellectual territory from multiple completely different sources.",
    "Name the convergent insight in 1-2 sentences — the core idea they keep returning to, and why it's notable that it arrived from such different starting points.",
    "Be specific about the divergent paths AND the convergent destination.",
    "Address the user directly as 'you'.",
    "Return strictly valid JSON (no markdown): {\"signal\": \"...\"}",
  ].join("\n");

  try {
    const response = await fetch(OPENAI_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: JSON.stringify({
              topic: args.topicName,
              captures: args.captures.map((c) => ({
                title: c.label,
                source: c.source ?? "unknown",
                key_idea: c.keyIdea ?? "",
              })),
            }),
          },
        ],
      }),
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = payload.choices?.[0]?.message?.content;
    if (!raw) return null;

    const parsed = JSON.parse(raw) as { signal?: unknown };
    if (typeof parsed.signal !== "string" || parsed.signal.trim().length === 0) return null;

    return parsed.signal.trim();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 1.6: Run tests and verify they pass**

```bash
npx vitest run src/server/intelligence.test.ts
```

Expected: All tests PASS (12 passing).

- [ ] **Step 1.7: Commit**

```bash
git add src/server/cognition/llm.ts src/server/intelligence.test.ts
git commit -m "feat: add LLM functions for contradiction tension, thread synthesis, convergence signal"
```

---

## Task 2: Service pure helpers

**Files:**
- Create: `src/server/services/intelligence.ts`
- Modify: `src/server/intelligence.test.ts` (append helper tests)

- [ ] **Step 2.1: Append pure helper tests to `src/server/intelligence.test.ts`**

Append to the end of the file:

```typescript
import {
  groupCapturesByTopic,
  findDormantThreads,
  buildEvolutionArc,
  findConvergenceCandidates,
  type LoadedCapture,
  type TopicGroup,
} from "@/server/services/intelligence";

function makeCapture(overrides: Partial<LoadedCapture> & { topics: LoadedCapture["topics"] }): LoadedCapture {
  return {
    id: overrides.id ?? "c1",
    label: overrides.label ?? "Untitled",
    rawText: overrides.rawText ?? null,
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

  it("excludes groups with fewer than 3 captures", () => {
    const groups = [makeGroup("t1", ["2026-04-01", "2026-03-01"])];
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

  it("returns at most 3 dormant threads", () => {
    const groups = Array.from({ length: 5 }, (_, i) =>
      makeGroup(`t${i}`, ["2026-04-01", "2026-03-01", "2026-02-01"]),
    );
    expect(findDormantThreads(groups, now).length).toBeLessThanOrEqual(3);
  });
});

// ── buildEvolutionArc ─────────────────────────────────────────────────────────

describe("buildEvolutionArc", () => {
  it("buckets captures into correct months", () => {
    const group: TopicGroup = {
      topicId: "t1",
      topicName: "philosophy",
      captures: [
        makeCapture({ id: "c1", capturedAt: new Date("2026-03-10"), topics: [{ topicId: "t1", name: "philosophy" }] }),
        makeCapture({ id: "c2", capturedAt: new Date("2026-03-20"), topics: [{ topicId: "t1", name: "philosophy" }] }),
        makeCapture({ id: "c3", capturedAt: new Date("2026-04-05"), topics: [{ topicId: "t1", name: "philosophy" }] }),
      ],
    };
    const arc = buildEvolutionArc(group);
    expect(arc.periods).toHaveLength(2);
    expect(arc.periods[0].month).toBe("2026-03");
    expect(arc.periods[0].captureCount).toBe(2);
    expect(arc.periods[1].month).toBe("2026-04");
    expect(arc.periods[1].captureCount).toBe(1);
  });

  it("extracts keyIdeas (up to 3 per period)", () => {
    const group: TopicGroup = {
      topicId: "t1",
      topicName: "philosophy",
      captures: [
        makeCapture({ id: "c1", capturedAt: new Date("2026-03-01"), keyIdea: "idea A", topics: [{ topicId: "t1", name: "philosophy" }] }),
        makeCapture({ id: "c2", capturedAt: new Date("2026-03-02"), keyIdea: "idea B", topics: [{ topicId: "t1", name: "philosophy" }] }),
        makeCapture({ id: "c3", capturedAt: new Date("2026-03-03"), keyIdea: "idea C", topics: [{ topicId: "t1", name: "philosophy" }] }),
        makeCapture({ id: "c4", capturedAt: new Date("2026-03-04"), keyIdea: "idea D", topics: [{ topicId: "t1", name: "philosophy" }] }),
      ],
    };
    const arc = buildEvolutionArc(group);
    expect(arc.periods[0].keyIdeas).toHaveLength(3);
  });

  it("sorts periods chronologically (oldest first)", () => {
    const group: TopicGroup = {
      topicId: "t1",
      topicName: "philosophy",
      captures: [
        makeCapture({ id: "c1", capturedAt: new Date("2026-05-01"), topics: [{ topicId: "t1", name: "philosophy" }] }),
        makeCapture({ id: "c2", capturedAt: new Date("2026-02-01"), topics: [{ topicId: "t1", name: "philosophy" }] }),
      ],
    };
    const arc = buildEvolutionArc(group);
    expect(arc.periods[0].month).toBe("2026-02");
    expect(arc.periods[1].month).toBe("2026-05");
  });
});

// ── findConvergenceCandidates ─────────────────────────────────────────────────

describe("findConvergenceCandidates", () => {
  it("returns empty when no groups have 3+ distinct sources", () => {
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
```

- [ ] **Step 2.2: Run tests to verify new tests fail**

```bash
npx vitest run src/server/intelligence.test.ts
```

Expected: New tests FAIL with "groupCapturesByTopic is not a function" (or similar). Existing LLM tests still PASS.

- [ ] **Step 2.3: Create `src/server/services/intelligence.ts` with types and pure helpers**

```typescript
import { MemoryEdgeType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/server/db";
import {
  generateContradictionTension,
  generateThreadSynthesis,
  generateConvergenceSignal,
} from "@/server/cognition/llm";

const THREAD_SYNTHESIS_THRESHOLD = 5;
const CONTRADICTION_LIMIT = 3;
const THREAD_SYNTHESIS_LIMIT = 2;
const DORMANT_ACTIVE_MIN = 3;
const DORMANT_SILENT_DAYS = 21;
const CONVERGENCE_SOURCE_MIN = 3;
const CAPTURE_SCAN_LIMIT = 200;

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
```

Note: `getPersonalIntelligence` will be added in Task 3. The file currently only exports types and pure helpers.

- [ ] **Step 2.4: Run tests and verify all pass**

```bash
npx vitest run src/server/intelligence.test.ts
```

Expected: All tests PASS (12 LLM tests + ~16 helper tests).

- [ ] **Step 2.5: Commit**

```bash
git add src/server/services/intelligence.ts src/server/intelligence.test.ts
git commit -m "feat: add pure helpers for personal intelligence (groupByTopic, dormant detection, evolution arc, convergence candidates)"
```

---

## Task 3: Orchestrator + API route

**Files:**
- Modify: `src/server/services/intelligence.ts` (append orchestrator)
- Create: `src/app/api/memory/intelligence/route.ts`

- [ ] **Step 3.1: Append `getPersonalIntelligence` to `src/server/services/intelligence.ts`**

Append after `findConvergenceCandidates`:

```typescript
export async function getPersonalIntelligence(args: {
  userId: string;
  db?: DbClient;
}): Promise<PersonalIntelligenceData> {
  const db = args.db ?? prisma;

  const [rawCaptures, contradictEdges] = await Promise.all([
    db.capturedItem.findMany({
      where: { userId: args.userId },
      orderBy: { capturedAt: "desc" },
      take: CAPTURE_SCAN_LIMIT,
      include: {
        contentItem: { include: { source: true } },
        topics: { include: { topic: true } },
      },
    }),
    db.memoryEdge.findMany({
      where: { userId: args.userId, type: MemoryEdgeType.CONTRADICTS },
      orderBy: { createdAt: "desc" },
      take: CONTRADICTION_LIMIT,
      include: {
        fromItem: { include: { contentItem: true } },
        toItem: { include: { contentItem: true } },
      },
    }),
  ]);

  const captures: LoadedCapture[] = rawCaptures.map((item) => ({
    id: item.id,
    label: item.contentItem?.title ?? item.rawText?.slice(0, 80) ?? "Untitled capture",
    rawText: item.rawText,
    keyIdea: item.keyIdea,
    capturedAt: item.capturedAt,
    sourceName: item.contentItem?.source?.name ?? item.contentItem?.siteName ?? null,
    topics: item.topics.map((row) => ({ topicId: row.topicId, name: row.topic.name })),
  }));

  const allGroups = groupCapturesByTopic(captures, 2);
  const threadCandidates = allGroups.filter((g) => g.captures.length >= THREAD_SYNTHESIS_THRESHOLD);

  const now = new Date();
  const dormantThreads = findDormantThreads(allGroups, now);
  const evolutionArcs = threadCandidates.slice(0, 3).map(buildEvolutionArc);
  const convergenceCandidates = findConvergenceCandidates(threadCandidates);

  function edgeItemLabel(item: { rawText: string | null; contentItem: { title: string } | null }): string {
    return item.contentItem?.title ?? item.rawText?.slice(0, 80) ?? "Untitled capture";
  }

  const [cardTensions, syntheses, firstConvergenceSignal] = await Promise.all([
    Promise.all(
      contradictEdges.map((edge) =>
        generateContradictionTension({
          labelA: edgeItemLabel(edge.fromItem),
          textA: edge.fromItem.rawText ?? edge.fromItem.keyIdea ?? "",
          labelB: edgeItemLabel(edge.toItem),
          textB: edge.toItem.rawText ?? edge.toItem.keyIdea ?? "",
        }),
      ),
    ),
    Promise.all(
      threadCandidates.slice(0, THREAD_SYNTHESIS_LIMIT).map((group) =>
        generateThreadSynthesis({
          topicName: group.topicName,
          captures: group.captures.slice(0, 10).map((c) => ({
            label: c.label,
            keyIdea: c.keyIdea,
            text: c.rawText ?? "",
          })),
        }),
      ),
    ),
    convergenceCandidates.length > 0
      ? generateConvergenceSignal({
          topicName: convergenceCandidates[0].topicName,
          captures: convergenceCandidates[0].captures.slice(0, 8).map((c) => ({
            label: c.label,
            source: c.sourceName,
            keyIdea: c.keyIdea,
          })),
        })
      : Promise.resolve(null),
  ]);

  const contradictionCards: ContradictionCard[] = contradictEdges
    .map((edge, i) => {
      const tension = cardTensions[i];
      if (!tension) return null;
      return {
        itemAId: edge.fromItemId,
        itemBId: edge.toItemId,
        labelA: edgeItemLabel(edge.fromItem),
        labelB: edgeItemLabel(edge.toItem),
        previewA: (edge.fromItem.rawText ?? edge.fromItem.keyIdea ?? "").slice(0, 200),
        previewB: (edge.toItem.rawText ?? edge.toItem.keyIdea ?? "").slice(0, 200),
        tension,
      };
    })
    .filter((c): c is ContradictionCard => c !== null);

  const threadSyntheses: ThreadSynthesis[] = threadCandidates
    .slice(0, THREAD_SYNTHESIS_LIMIT)
    .map((group, i) => {
      const synthesis = syntheses[i];
      if (!synthesis) return null;
      return {
        topicId: group.topicId,
        topicName: group.topicName,
        captureCount: group.captures.length,
        position: synthesis.position,
        openQuestion: synthesis.openQuestion,
      };
    })
    .filter((s): s is ThreadSynthesis => s !== null);

  const convergenceSignals: ConvergenceSignal[] =
    firstConvergenceSignal && convergenceCandidates.length > 0
      ? [
          {
            topicId: convergenceCandidates[0].topicId,
            topicName: convergenceCandidates[0].topicName,
            captureCount: convergenceCandidates[0].captures.length,
            sourceCount: new Set(
              convergenceCandidates[0].captures.map((c) => c.sourceName ?? "__unknown__"),
            ).size,
            signal: firstConvergenceSignal,
          },
        ]
      : [];

  return {
    contradictionCards,
    threadSyntheses,
    convergenceSignals,
    evolutionArcs,
    dormantThreads,
  };
}
```

- [ ] **Step 3.2: Create `src/app/api/memory/intelligence/route.ts`**

```typescript
import { handleRoute } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { getPersonalIntelligence } from "@/server/services/intelligence";

export async function GET(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    return getPersonalIntelligence({ userId });
  });
}
```

- [ ] **Step 3.3: Run unit tests to confirm nothing is broken**

```bash
npm run test:unit
```

Expected: All tests PASS.

- [ ] **Step 3.4: Commit**

```bash
git add src/server/services/intelligence.ts src/app/api/memory/intelligence/route.ts
git commit -m "feat: add getPersonalIntelligence service and GET /api/memory/intelligence route"
```

---

## Task 4: Mobile types + API client

**Files:**
- Modify: `mobile/types/api.ts`
- Modify: `mobile/lib/api.ts`

- [ ] **Step 4.1: Add Phase 2 types to `mobile/types/api.ts`**

Append after the last interface in the file:

```typescript
export interface ContradictionCard {
  itemAId: string;
  itemBId: string;
  labelA: string;
  labelB: string;
  previewA: string;
  previewB: string;
  tension: string;
}

export interface ThreadSynthesis {
  topicId: string;
  topicName: string;
  captureCount: number;
  position: string;
  openQuestion: string;
}

export interface ConvergenceSignal {
  topicId: string;
  topicName: string;
  captureCount: number;
  sourceCount: number;
  signal: string;
}

export interface EvolutionPeriod {
  month: string;
  captureCount: number;
  keyIdeas: string[];
}

export interface EvolutionArc {
  topicId: string;
  topicName: string;
  captureCount: number;
  periods: EvolutionPeriod[];
}

export interface DormantThread {
  topicId: string;
  topicName: string;
  captureCount: number;
  lastCapturedAt: string;
  daysSilent: number;
}

export interface PersonalIntelligenceResponse {
  contradictionCards: ContradictionCard[];
  threadSyntheses: ThreadSynthesis[];
  convergenceSignals: ConvergenceSignal[];
  evolutionArcs: EvolutionArc[];
  dormantThreads: DormantThread[];
}
```

- [ ] **Step 4.2: Add `api.memory.intelligence()` to `mobile/lib/api.ts`**

In `mobile/lib/api.ts`, update the `memory` section of the `api` object. Add the import at the top:

```typescript
import type {
  // existing imports...
  PersonalIntelligenceResponse,
} from '@/types/api';
```

Then add `intelligence` to the `memory` object:

```typescript
  memory: {
    graph(params?: { limit?: number }) {
      return request<MemoryGraphResponse>(`/api/memory/graph${buildQuery(params ?? {})}`);
    },
    trends(params?: { window?: 'week' | 'month' }) {
      return request<MemoryTrendsResponse>(`/api/memory/trends${buildQuery(params ?? {})}`);
    },
    intelligence() {
      return request<PersonalIntelligenceResponse>('/api/memory/intelligence');
    },
  },
```

- [ ] **Step 4.3: Commit**

```bash
git add mobile/types/api.ts mobile/lib/api.ts
git commit -m "feat: add PersonalIntelligenceResponse types and api.memory.intelligence() client method"
```

---

## Task 5: Mobile Mind screen

**Files:**
- Create: `mobile/app/(tabs)/mind.tsx`
- Modify: `mobile/app/(tabs)/_layout.tsx`

- [ ] **Step 5.1: Create `mobile/app/(tabs)/mind.tsx`**

```typescript
import React, { useCallback } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { Radius, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonCard } from '@/components/ui/Skeleton';
import type {
  ContradictionCard,
  ThreadSynthesis,
  ConvergenceSignal,
  EvolutionArc,
  DormantThread,
} from '@/types/api';

// ── Contradiction card ────────────────────────────────────────────────────────

function ContradictionCardView({
  card,
  onPressA,
  onPressB,
}: {
  card: ContradictionCard;
  onPressA: () => void;
  onPressB: () => void;
}) {
  const c = useThemeColors();
  return (
    <View style={[styles.card, { borderColor: c.border }]}>
      <View style={styles.contradictRow}>
        <Pressable
          style={[styles.contradictSide, { borderColor: c.borderSubtle }]}
          onPress={onPressA}
        >
          <Text variant="monoSmall" color="muted">A</Text>
          <Text variant="bodyMedium" numberOfLines={2} style={{ marginTop: 4 }}>
            {card.labelA}
          </Text>
          {!!card.previewA && (
            <Text variant="monoSmall" color="muted" numberOfLines={3} style={{ marginTop: 4 }}>
              {card.previewA}
            </Text>
          )}
        </Pressable>
        <Pressable
          style={[styles.contradictSide, { borderColor: c.borderSubtle }]}
          onPress={onPressB}
        >
          <Text variant="monoSmall" color="muted">B</Text>
          <Text variant="bodyMedium" numberOfLines={2} style={{ marginTop: 4 }}>
            {card.labelB}
          </Text>
          {!!card.previewB && (
            <Text variant="monoSmall" color="muted" numberOfLines={3} style={{ marginTop: 4 }}>
              {card.previewB}
            </Text>
          )}
        </Pressable>
      </View>
      <View style={[styles.tensionRow, { borderTopColor: c.borderSubtle }]}>
        <Text variant="monoSmall" color="muted" style={styles.tensionLabel}>tension</Text>
        <Text variant="body" color="secondary" style={{ marginTop: Spacing[2] }}>
          {card.tension}
        </Text>
      </View>
    </View>
  );
}

// ── Thread synthesis ──────────────────────────────────────────────────────────

function ThreadSynthesisView({ synthesis }: { synthesis: ThreadSynthesis }) {
  const c = useThemeColors();
  return (
    <View style={[styles.card, { borderColor: c.border }]}>
      <View style={styles.synthesisMeta}>
        <Text variant="monoSmall" color="muted">{synthesis.topicName}</Text>
        <Text variant="monoSmall" color="muted">{synthesis.captureCount} captures</Text>
      </View>
      <Text variant="bodyMedium" style={{ marginTop: Spacing[3] }}>
        {synthesis.position}
      </Text>
      <View style={[styles.openQuestionRow, { borderTopColor: c.borderSubtle }]}>
        <Text variant="monoSmall" color="muted" style={styles.openQuestionLabel}>open question</Text>
        <Text variant="monoSmall" color="secondary" style={{ marginTop: Spacing[2] }}>
          {synthesis.openQuestion}
        </Text>
      </View>
    </View>
  );
}

// ── Convergence signal ────────────────────────────────────────────────────────

function ConvergenceSignalView({ signal }: { signal: ConvergenceSignal }) {
  const c = useThemeColors();
  return (
    <View style={[styles.card, { borderColor: c.border }]}>
      <View style={styles.synthesisMeta}>
        <Text variant="monoSmall" color="muted">{signal.topicName}</Text>
        <Text variant="monoSmall" color="muted">{signal.sourceCount} sources</Text>
      </View>
      <Text variant="body" color="secondary" style={{ marginTop: Spacing[3] }}>
        {signal.signal}
      </Text>
    </View>
  );
}

// ── Evolution arc ─────────────────────────────────────────────────────────────

function EvolutionArcView({ arc }: { arc: EvolutionArc }) {
  const c = useThemeColors();
  const maxCount = Math.max(1, ...arc.periods.map((p) => p.captureCount));

  return (
    <View style={[styles.card, { borderColor: c.border }]}>
      <View style={styles.synthesisMeta}>
        <Text variant="monoSmall" color="muted">{arc.topicName}</Text>
        <Text variant="monoSmall" color="muted">{arc.captureCount} total</Text>
      </View>
      <View style={styles.arcRow}>
        {arc.periods.map((period) => (
          <View key={period.month} style={styles.arcPeriod}>
            <View
              style={[
                styles.arcBar,
                {
                  height: 4 + (period.captureCount / maxCount) * 32,
                  backgroundColor: c.text,
                },
              ]}
            />
            <Text variant="monoSmall" style={[styles.arcMonth, { color: c.faint }]}>
              {period.month.slice(5)}
            </Text>
          </View>
        ))}
      </View>
      {arc.periods.at(-1)?.keyIdeas.length ? (
        <Text variant="monoSmall" color="muted" style={{ marginTop: Spacing[3] }}>
          Recent: {arc.periods.at(-1)!.keyIdeas[0]}
        </Text>
      ) : null}
    </View>
  );
}

// ── Dormant thread ────────────────────────────────────────────────────────────

function DormantThreadView({ thread }: { thread: DormantThread }) {
  const c = useThemeColors();
  return (
    <View style={[styles.dormantRow, { borderBottomColor: c.border }]}>
      <Text variant="bodyMedium">{thread.topicName}</Text>
      <Text variant="monoSmall" color="muted" style={{ marginTop: 4 }}>
        {thread.captureCount} captures · quiet for {thread.daysSilent} days
      </Text>
    </View>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function MindScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const { data, loading, error, refetch } = useApiQuery(
    () => api.memory.intelligence(),
    [],
  );

  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  const isEmpty =
    !loading &&
    !error &&
    data &&
    data.contradictionCards.length === 0 &&
    data.threadSyntheses.length === 0 &&
    data.convergenceSignals.length === 0 &&
    data.evolutionArcs.length === 0 &&
    data.dormantThreads.length === 0;

  if (loading && !data) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
        <View style={[styles.header, { borderBottomColor: c.border }]}>
          <Text variant="wordmark">Mind</Text>
        </View>
        <SkeletonCard />
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
        <View style={[styles.header, { borderBottomColor: c.border }]}>
          <Text variant="wordmark">Mind</Text>
        </View>
        <EmptyState title="Mind unavailable" body={error} ctaLabel="Retry" onCta={refetch} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <Text variant="wordmark">Mind</Text>
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={refetch} tintColor={c.text} />
        }
        showsVerticalScrollIndicator={false}
      >
        <Text variant="serif" color="secondary" style={styles.lead}>
          What you didn't know you know.
        </Text>

        {isEmpty && (
          <Text variant="body" color="muted" style={styles.emptyNote}>
            Keep capturing. Tensions, threads, and patterns will surface once your map has enough depth.
          </Text>
        )}

        {/* Tensions */}
        {(data?.contradictionCards.length ?? 0) > 0 && (
          <>
            <Text variant="h3" style={styles.sectionHead}>Tensions</Text>
            <Text variant="body" color="muted" style={styles.sectionSub}>
              Two things you hold that pull in opposite directions.
            </Text>
            {data!.contradictionCards.map((card) => (
              <ContradictionCardView
                key={`${card.itemAId}-${card.itemBId}`}
                card={card}
                onPressA={() => router.push(`/insight/${card.itemAId}` as never)}
                onPressB={() => router.push(`/insight/${card.itemBId}` as never)}
              />
            ))}
          </>
        )}

        {/* Thread syntheses */}
        {(data?.threadSyntheses.length ?? 0) > 0 && (
          <>
            <Text variant="h3" style={styles.sectionHead}>Threads</Text>
            <Text variant="body" color="muted" style={styles.sectionSub}>
              Where your thinking on these topics appears to have landed.
            </Text>
            {data!.threadSyntheses.map((synthesis) => (
              <ThreadSynthesisView key={synthesis.topicId} synthesis={synthesis} />
            ))}
          </>
        )}

        {/* Convergence */}
        {(data?.convergenceSignals.length ?? 0) > 0 && (
          <>
            <Text variant="h3" style={styles.sectionHead}>Convergence</Text>
            <Text variant="body" color="muted" style={styles.sectionSub}>
              The same idea arriving from different directions.
            </Text>
            {data!.convergenceSignals.map((signal) => (
              <ConvergenceSignalView key={signal.topicId} signal={signal} />
            ))}
          </>
        )}

        {/* Evolution */}
        {(data?.evolutionArcs.length ?? 0) > 0 && (
          <>
            <Text variant="h3" style={styles.sectionHead}>Evolution</Text>
            <Text variant="body" color="muted" style={styles.sectionSub}>
              How your engagement with these topics has shifted over time.
            </Text>
            {data!.evolutionArcs.map((arc) => (
              <EvolutionArcView key={arc.topicId} arc={arc} />
            ))}
          </>
        )}

        {/* Dormant threads */}
        {(data?.dormantThreads.length ?? 0) > 0 && (
          <>
            <Text variant="h3" style={styles.sectionHead}>Dormant</Text>
            <Text variant="body" color="muted" style={styles.sectionSub}>
              Threads you were deep in — still waiting.
            </Text>
            {data!.dormantThreads.map((thread) => (
              <DormantThreadView key={thread.topicId} thread={thread} />
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    paddingHorizontal: Spacing[6],
    paddingVertical: Spacing[4],
    borderBottomWidth: 1,
  },
  content: {
    paddingHorizontal: Spacing[6],
    paddingBottom: Spacing[16],
  },
  lead: {
    marginTop: Spacing[6],
    maxWidth: 320,
  },
  emptyNote: {
    marginTop: Spacing[6],
    maxWidth: 320,
  },
  sectionHead: {
    marginTop: Spacing[10],
  },
  sectionSub: {
    marginTop: Spacing[2],
    marginBottom: Spacing[4],
    maxWidth: 320,
  },
  card: {
    borderWidth: 1,
    borderRadius: Radius.md,
    marginBottom: Spacing[4],
    overflow: 'hidden',
  },
  contradictRow: {
    flexDirection: 'row',
  },
  contradictSide: {
    flex: 1,
    padding: Spacing[4],
    borderRightWidth: 0.5,
  },
  tensionRow: {
    padding: Spacing[4],
    borderTopWidth: 1,
  },
  tensionLabel: {
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  synthesisMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: Spacing[4],
    paddingBottom: 0,
  },
  openQuestionRow: {
    padding: Spacing[4],
    marginTop: Spacing[4],
    borderTopWidth: 1,
  },
  openQuestionLabel: {
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  arcRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    paddingHorizontal: Spacing[4],
    paddingTop: Spacing[4],
    height: 48,
  },
  arcPeriod: {
    alignItems: 'center',
    gap: 4,
  },
  arcBar: {
    width: 16,
    borderRadius: 2,
  },
  arcMonth: {
    fontSize: 9,
  },
  dormantRow: {
    paddingVertical: Spacing[4],
    borderBottomWidth: 1,
  },
});
```

- [ ] **Step 5.2: Add Mind tab to `mobile/app/(tabs)/_layout.tsx`**

In `_layout.tsx`, update the imports to add `ZapIcon`:

```typescript
import { GitGraphIcon, LineChartIcon, ListIcon, UserIcon, ZapIcon } from 'lucide-react-native';
```

Then add the new `Tabs.Screen` after the `trends` screen and before the `profile` screen:

```typescript
      <Tabs.Screen
        name="mind"
        options={{
          title: 'Mind',
          tabBarIcon: ({ color }) => <TabBarIcon color={color} icon={ZapIcon} />,
        }}
      />
```

- [ ] **Step 5.3: Run unit tests to confirm nothing is broken**

```bash
npm run test:unit
```

Expected: All tests PASS.

- [ ] **Step 5.4: Commit**

```bash
git add mobile/app/(tabs)/mind.tsx mobile/app/(tabs)/_layout.tsx
git commit -m "feat: add Mind tab — contradiction cards, thread synthesis, convergence, evolution, dormant threads"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] Contradiction cards — surfaced side-by-side with specific tension named (ContradictionCardView)
- [x] Thread synthesis — position statement (not a summary), open question (ThreadSynthesisView)
- [x] Convergence detection — "same core idea from different sources" narrative (ConvergenceSignalView)
- [x] Evolution timeline — monthly arc with capture counts and key ideas (EvolutionArcView)
- [x] Dormant thread nudge — low-pressure, shows days silent (DormantThreadView)

**Spec items deliberately deferred:**
- "Dismiss / sit with it / flag as genuine tension" actions on contradiction cards — spec Phase 2 does not require interactive state on these cards; interactions belong in Phase 3's Position System
- Caching — not needed for Phase 2 scale

**Placeholder scan:** None — all code steps contain complete implementations.

**Type consistency:**
- `ThreadSynthesis.openQuestion` (camelCase) maps to `open_question` in LLM JSON — handled in `generateThreadSynthesis` with `parsed.open_question`
- `ContradictionCard` types match between `intelligence.ts` (backend) and `mobile/types/api.ts`
- `buildEvolutionArc` returns `EvolutionArc` with `periods: EvolutionPeriod[]` — used correctly in `EvolutionArcView`
