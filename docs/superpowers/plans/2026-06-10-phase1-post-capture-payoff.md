# Phase 1 — Post-Capture Payoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bare post-capture screen with a rich payoff moment: specific connections to past captures, thread context, and 3 curated next-step recommendations — plus a visual landing animation on the map when the new node appears.

**Architecture:** Three backend additions (thread context computation, recommendations LLM call, return type update) drive two frontend changes (richer StepThree component, animated node landing). Recommendations run in parallel with the DB transaction to avoid adding latency. The landing animation uses an `Animated.View` ring rendered in screen coordinates over the map canvas, keyed off `newNodeId` state that clears after the animation finishes.

**Tech Stack:** TypeScript, Next.js 14, Prisma, OpenAI (gpt-4o-mini), Expo/React Native, react-native-svg, vitest

---

## File Map

| File | Change |
|---|---|
| `src/server/cognition/llm.ts` | Add `Recommendation` type + `generateRecommendations` function |
| `src/server/services/cognition.ts` | Extract `itemTitle`, add `computeThreadContext`, run recommendations in parallel, update return type |
| `src/server/cognition.test.ts` | New: unit tests for `computeThreadContext` and `generateRecommendations` |
| `mobile/types/api.ts` | Add `Recommendation` interface, add `threadContext` + `recommendations` to `CaptureResponse` |
| `mobile/app/(tabs)/index.tsx` | Add `edgeLabel` helper, rework `StepThree`, add `newNodeId`/`landingAnim` state + landing animation |

---

## Task 1: Add `generateRecommendations` to the LLM module

**Files:**
- Modify: `src/server/cognition/llm.ts`

- [ ] **Step 1: Add `Recommendation` type and `generateRecommendations` function**

Append to the bottom of `src/server/cognition/llm.ts`:

```typescript
export type Recommendation = {
  title: string;
  author: string;
  why: string;
};

export async function generateRecommendations(args: {
  itemTitle: string;
  contentText?: string;
  topicNames: string[];
  threadContext?: { topicName: string; captureCount: number };
  neighborTitles: string[];
}): Promise<Recommendation[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const threadNote = args.threadContext && args.threadContext.captureCount >= 2
    ? `The user has captured ${args.threadContext.captureCount} things on "${args.threadContext.topicName}" — this is the next entry in that thread.`
    : "";

  const systemPrompt = [
    "Recommend exactly 3 specific pieces of content for a user to explore next, given what they just captured.",
    "",
    "Requirements:",
    "- Each recommendation must be a real, specific work (book, essay, paper, talk, or article) with an actual named author.",
    "- 'why' must name the specific intellectual connection — not 'this is relevant' but the precise bridge (shared argument, opposing view, historical antecedent, empirical grounding, etc.).",
    "- Vary the format: do not recommend 3 books or 3 articles. Mix at least 2 different formats.",
    "- Prioritize depth over breadth — go deeper into the thread, not sideways into adjacent topics.",
    "- Do not recommend things the user has already captured (given the neighbor titles).",
    "",
    threadNote,
    "",
    "Return strictly valid JSON (no markdown):",
    '{"recommendations": [{"title": "...", "author": "...", "why": "..."}]}',
  ].filter(Boolean).join("\n");

  const userMessage = {
    captured_title: args.itemTitle,
    captured_text: args.contentText?.slice(0, 800) ?? "",
    topics: args.topicNames,
    already_in_map: args.neighborTitles,
  };

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
        temperature: 0.5,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify(userMessage) },
        ],
      }),
    });

    if (!response.ok) return [];

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return [];

    const parsed = JSON.parse(content) as {
      recommendations?: { title?: string; author?: string; why?: string }[];
    };

    if (!Array.isArray(parsed.recommendations)) return [];

    return parsed.recommendations
      .filter((r): r is Recommendation =>
        typeof r.title === "string" && r.title.length > 0 &&
        typeof r.author === "string" && r.author.length > 0 &&
        typeof r.why === "string" && r.why.length > 0,
      )
      .slice(0, 3);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd "/Users/aaronpinto/Desktop/Intellectual App V2" && npx tsc --noEmit
```

Expected: no errors (or only pre-existing errors unrelated to this file).

---

## Task 2: Add thread context computation to the cognition service

**Files:**
- Modify: `src/server/services/cognition.ts`

- [ ] **Step 1: Add `generateRecommendations` and `Recommendation` to the import from llm.ts**

Find the existing import line at the top of `src/server/services/cognition.ts`:

```typescript
import { polishInsights } from "@/server/cognition/llm";
```

Replace it with:

```typescript
import { generateRecommendations, polishInsights, type Recommendation } from "@/server/cognition/llm";
```

- [ ] **Step 2: Export `computeThreadContext` as a pure function (just before `captureItem`)**

Insert this function just before the `export async function captureItem` line:

```typescript
export function computeThreadContext(
  topicCounts: TopicCount[],
): { topicName: string; captureCount: number } | null {
  if (topicCounts.length === 0 || topicCounts[0].count < 2) return null;
  return { topicName: topicCounts[0].name, captureCount: topicCounts[0].count };
}
```

- [ ] **Step 3: Update `captureItem` return type signature**

Find the return type annotation on `captureItem`:

```typescript
export async function captureItem(payload: CapturePayload): Promise<CapturedItemSummary & {
  insights: { id: string; type: string; headline: string; body: string; strength: number; evidence: unknown }[];
  related: CapturedItemSummary[];
  edges: { fromItemId: string; toItemId: string; type: string; weight: number }[];
}> {
```

Replace with:

```typescript
export async function captureItem(payload: CapturePayload): Promise<CapturedItemSummary & {
  insights: { id: string; type: string; headline: string; body: string; strength: number; evidence: unknown }[];
  related: CapturedItemSummary[];
  edges: { fromItemId: string; toItemId: string; type: string; weight: number }[];
  threadContext: { topicName: string; captureCount: number } | null;
  recommendations: Recommendation[];
}> {
```

- [ ] **Step 4: Extract `itemTitle` and compute `threadContext` before the transaction**

Inside `captureItem`, find these lines that appear just before `return prisma.$transaction`:

```typescript
  const isFirstCapture = neighborInfo.priorCount === 0;
  const topicMap = new Map<string, ClassifiedTopic>(
    classified.map((topic) => [topic.topicId, topic]),
  );
  const topicCounts = computeTopicCounts(neighborInfo.rawPriors, topicMap);
  const trajectory = computeTrajectory(neighborInfo.rawPriors, topicMap);

  return prisma.$transaction(async (tx: DbClient) => {
```

Replace with:

```typescript
  const isFirstCapture = neighborInfo.priorCount === 0;
  const topicMap = new Map<string, ClassifiedTopic>(
    classified.map((topic) => [topic.topicId, topic]),
  );
  const topicCounts = computeTopicCounts(neighborInfo.rawPriors, topicMap);
  const trajectory = computeTrajectory(neighborInfo.rawPriors, topicMap);

  const fallbackText = (payload.text ?? payload.caption ?? "").slice(0, 80);
  const itemTitle = contentTitle ?? (fallbackText.length > 0 ? fallbackText : "Untitled capture");
  const threadContext = computeThreadContext(topicCounts);

  const [txResult, recommendations] = await Promise.all([
    prisma.$transaction(async (tx: DbClient) => {
```

- [ ] **Step 5: Remove the duplicate `itemTitle` inside the transaction and close the `Promise.all`**

Inside the transaction body, find and remove this block (it's now computed above):

```typescript
    const fallbackText = (payload.text ?? payload.caption ?? "").slice(0, 80);
    const itemTitle = contentTitle ?? (fallbackText.length > 0 ? fallbackText : "Untitled capture");
```

Then find the closing of the transaction — where `return { ...serializeCapturedItem(fullItem), ... }` ends — and wrap the `Promise.all` properly. Find the end of the transaction block:

```typescript
    return {
      ...serializeCapturedItem(fullItem),
      insights: insightRows.map((row) => ({
        id: row.id,
        type: row.type,
        headline: row.headline,
        body: row.body,
        strength: row.strength,
        evidence: row.evidence,
      })),
      related,
      edges: neighborInfo.neighbors.map((neighbor) => ({
        fromItemId: created.id,
        toItemId: neighbor.capturedItemId,
        type: neighbor.edgeType,
        weight: Number(neighbor.similarity.toFixed(4)),
      })),
    };
  });
}
```

Replace with:

```typescript
    return {
      ...serializeCapturedItem(fullItem),
      insights: insightRows.map((row) => ({
        id: row.id,
        type: row.type,
        headline: row.headline,
        body: row.body,
        strength: row.strength,
        evidence: row.evidence,
      })),
      related,
      edges: neighborInfo.neighbors.map((neighbor) => ({
        fromItemId: created.id,
        toItemId: neighbor.capturedItemId,
        type: neighbor.edgeType,
        weight: Number(neighbor.similarity.toFixed(4)),
      })),
    };
  }),
    generateRecommendations({
      itemTitle,
      contentText: combinedText,
      topicNames: classified.map((t) => t.name),
      threadContext: threadContext ?? undefined,
      neighborTitles: neighborInfo.neighbors.slice(0, 3).map((n) => n.title),
    }),
  ]);

  return { ...txResult, threadContext, recommendations };
}
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd "/Users/aaronpinto/Desktop/Intellectual App V2" && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/server/cognition/llm.ts src/server/services/cognition.ts
git commit -m "feat: add thread context and recommendations to capture response"
```

---

## Task 3: Write unit tests for the new cognition logic

**Files:**
- Create: `src/server/cognition.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/server/cognition.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from "vitest";
import { computeThreadContext } from "@/server/services/cognition";
import { generateRecommendations } from "@/server/cognition/llm";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("computeThreadContext", () => {
  it("returns null when topicCounts is empty", () => {
    expect(computeThreadContext([])).toBeNull();
  });

  it("returns null when the top topic count is 1 (first capture on that topic)", () => {
    expect(computeThreadContext([
      { topicId: "t1", name: "existentialism", count: 1 },
    ])).toBeNull();
  });

  it("returns the top topic when count >= 2", () => {
    expect(computeThreadContext([
      { topicId: "t1", name: "existentialism", count: 4 },
      { topicId: "t2", name: "phenomenology", count: 2 },
    ])).toEqual({ topicName: "existentialism", captureCount: 4 });
  });

  it("uses the first entry (highest count) when multiple topics qualify", () => {
    expect(computeThreadContext([
      { topicId: "t1", name: "consciousness studies", count: 3 },
      { topicId: "t2", name: "hard problem", count: 5 },
    ])).toEqual({ topicName: "consciousness studies", captureCount: 3 });
  });
});

describe("generateRecommendations", () => {
  it("returns empty array when OPENAI_API_KEY is not set", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const result = await generateRecommendations({
      itemTitle: "Test",
      topicNames: ["philosophy"],
      neighborTitles: [],
    });
    expect(result).toEqual([]);
  });

  it("returns 3 recommendations from a valid API response", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              recommendations: [
                { title: "Being and Time", author: "Martin Heidegger", why: "Grounds Sartre's account of radical freedom in the structure of Dasein's being-toward-death." },
                { title: "Existentialism Is a Humanism", author: "Jean-Paul Sartre", why: "The lecture where Sartre directly addresses the charge that existentialism leads to despair." },
                { title: "The Myth of Sisyphus", author: "Albert Camus", why: "Offers the absurdist counter to existentialist bad faith — confronts the same problem from outside the tradition." },
              ],
            }),
          },
        }],
      }),
    }));

    const result = await generateRecommendations({
      itemTitle: "No Exit",
      topicNames: ["existentialism", "bad faith"],
      neighborTitles: [],
    });

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({
      title: "Being and Time",
      author: "Martin Heidegger",
      why: "Grounds Sartre's account of radical freedom in the structure of Dasein's being-toward-death.",
    });
  });

  it("returns empty array when the API response is malformed", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "not json" } }] }),
    }));

    const result = await generateRecommendations({
      itemTitle: "Test",
      topicNames: [],
      neighborTitles: [],
    });

    expect(result).toEqual([]);
  });

  it("filters out recommendations missing required fields", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              recommendations: [
                { title: "Good Book", author: "Someone", why: "Good reason" },
                { title: "Missing author", why: "reason" },
                { author: "Missing title", why: "reason" },
              ],
            }),
          },
        }],
      }),
    }));

    const result = await generateRecommendations({
      itemTitle: "Test",
      topicNames: [],
      neighborTitles: [],
    });

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Good Book");
  });

  it("returns empty array when fetch fails", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));

    const result = await generateRecommendations({
      itemTitle: "Test",
      topicNames: [],
      neighborTitles: [],
    });

    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd "/Users/aaronpinto/Desktop/Intellectual App V2" && npm run test:unit -- src/server/cognition.test.ts
```

Expected: FAIL — `computeThreadContext` and `generateRecommendations` not exported yet.

- [ ] **Step 3: Run tests again after Tasks 1 and 2 are complete**

```bash
cd "/Users/aaronpinto/Desktop/Intellectual App V2" && npm run test:unit -- src/server/cognition.test.ts
```

Expected: all 8 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/server/cognition.test.ts
git commit -m "test: add unit tests for computeThreadContext and generateRecommendations"
```

---

## Task 4: Update mobile types

**Files:**
- Modify: `mobile/types/api.ts`

- [ ] **Step 1: Add `Recommendation` interface and update `CaptureResponse`**

Find this block in `mobile/types/api.ts`:

```typescript
export interface CaptureResponse extends CapturedItem {
  insights: InsightCard[];
  related: RelatedItem[];
  edges: { fromItemId: string; toItemId: string; type: MemoryEdgeType; weight: number }[];
}
```

Replace with:

```typescript
export interface Recommendation {
  title: string;
  author: string;
  why: string;
}

export interface CaptureResponse extends CapturedItem {
  insights: InsightCard[];
  related: RelatedItem[];
  edges: { fromItemId: string; toItemId: string; type: MemoryEdgeType; weight: number }[];
  threadContext: { topicName: string; captureCount: number } | null;
  recommendations: Recommendation[];
}
```

- [ ] **Step 2: Verify TypeScript compiles in the mobile project**

```bash
cd "/Users/aaronpinto/Desktop/Intellectual App V2/mobile" && npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add mobile/types/api.ts
git commit -m "feat: add threadContext and recommendations to CaptureResponse type"
```

---

## Task 5: Rework StepThree and add map landing animation

**Files:**
- Modify: `mobile/app/(tabs)/index.tsx`

- [ ] **Step 1: Add `Recommendation` import to the types import**

Find the types import line at the top of `mobile/app/(tabs)/index.tsx`:

```typescript
import type { CaptureKind, CaptureResponse, MemoryGraphResponse } from '@/types/api';
```

Replace with:

```typescript
import type { CaptureKind, CaptureResponse, MemoryEdgeType, MemoryGraphResponse, Recommendation } from '@/types/api';
```

- [ ] **Step 2: Add the `edgeLabel` helper function**

Add this function just before the `function Divider` definition (around line 235):

```typescript
function edgeLabel(type: MemoryEdgeType): string {
  switch (type) {
    case 'REINFORCES': return 'reinforces';
    case 'CONTRADICTS': return 'challenges';
    case 'RECURS': return 'recurs in';
    case 'EVOLVES_FROM': return 'evolves from';
    default: return 'connects to';
  }
}
```

- [ ] **Step 3: Replace `StepThree` with the enriched version**

Find and replace the entire `function StepThree` component (lines 349–402):

```typescript
function StepThree({
  result, onViewInsight, onBackToMap, c,
}: {
  result: CaptureResponse; onViewInsight: () => void; onBackToMap: () => void;
  c: AppThemeColors;
}) {
  const topConnections = result.related?.slice(0, 3) ?? [];
  const { threadContext, recommendations } = result;

  return (
    <View>
      <Text variant="monoSmall" style={{ color: c.muted, textAlign: 'center', letterSpacing: 2.5, marginTop: Spacing[2] }}>
        ── committed to memory ──
      </Text>
      <Text variant="serifLg" color="primary" style={[sh.heading, { marginTop: Spacing[5] }]} numberOfLines={4}>
        {result.title ?? result.rawText?.slice(0, 120) ?? 'Saved.'}
      </Text>

      {!!threadContext && threadContext.captureCount >= 2 && (
        <View style={{ marginTop: Spacing[3], marginBottom: Spacing[2] }}>
          <Text variant="monoSmall" style={{ color: c.muted }}>
            capture {threadContext.captureCount} on {threadContext.topicName.toLowerCase()}.
          </Text>
        </View>
      )}

      <Divider c={c} />

      {topConnections.length > 0 && (
        <View style={{ marginBottom: Spacing[5] }}>
          <Text variant="monoSmall" style={{ color: c.muted, marginBottom: Spacing[3] }}>CONNECTED TO_</Text>
          {topConnections.map((item) => (
            <View key={item.id} style={{ marginBottom: Spacing[3] }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: Spacing[2] }}>
                <Text variant="monoSmall" style={{ color: c.faint, marginTop: 2 }}>
                  {edgeLabel(item.edgeType ?? 'RELATED')} ·
                </Text>
                <Text variant="serif" color="secondary" style={{ flex: 1 }} numberOfLines={2}>
                  {item.title}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {!!recommendations && recommendations.length > 0 && (
        <View style={{ marginBottom: Spacing[5] }}>
          <Text variant="monoSmall" style={{ color: c.muted, marginBottom: Spacing[3] }}>WHERE TO GO NEXT_</Text>
          {recommendations.map((rec: Recommendation, i: number) => (
            <View key={i} style={{ marginBottom: Spacing[4] }}>
              <Text variant="serif" color="primary" numberOfLines={2}>{rec.title}</Text>
              <Text variant="monoSmall" style={{ color: c.faint, marginTop: Spacing[1] }}>{rec.author}</Text>
              <Text variant="monoSmall" style={{ color: c.muted, marginTop: Spacing[2], lineHeight: 16 }} numberOfLines={3}>
                {rec.why}
              </Text>
            </View>
          ))}
        </View>
      )}

      <Divider c={c} />
      <View style={sh.actions}>
        <Pressable onPress={onBackToMap} style={sh.secondaryBtn}>
          <Text variant="monoSmall" style={{ color: c.muted }}>← map</Text>
        </Pressable>
        <Pressable onPress={onViewInsight} style={[sh.primaryBtn, { backgroundColor: c.text }]}>
          <Text variant="monoSmall" style={{ color: c.background }}>view insight →</Text>
        </Pressable>
      </View>
    </View>
  );
}
```

- [ ] **Step 4: Add `newNodeId` state and `landingAnim` ref inside `MapScreen`**

Inside `MapScreen`, find this block (around line 800):

```typescript
  const [captureResult, setCaptureResult] = useState<CaptureResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [captureError, setCaptureError] = useState('');
```

Replace with:

```typescript
  const [captureResult, setCaptureResult] = useState<CaptureResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [captureError, setCaptureError] = useState('');
  const [newNodeId, setNewNodeId] = useState<string | null>(null);
  const landingAnim = useRef(new RNAnimated.Value(0)).current;
```

- [ ] **Step 5: Set `newNodeId` in the `commit` callback after a successful capture**

Find this block inside the `commit` callback:

```typescript
      setCaptureResult(res);
      setStep(3);
      void refetchGraph();
```

Replace with:

```typescript
      setCaptureResult(res);
      setStep(3);
      setNewNodeId(res.id);
      void refetchGraph();
```

- [ ] **Step 6: Add a `useEffect` to trigger the landing animation when the new node appears on the map**

Add this `useEffect` after the existing `useEffect` that handles `toolMode === 'search'` focus (around line 888):

```typescript
  useEffect(() => {
    if (!newNodeId || !pos[newNodeId]) return;
    landingAnim.setValue(0);
    RNAnimated.sequence([
      RNAnimated.timing(landingAnim, { toValue: 1, duration: 450, useNativeDriver: true }),
      RNAnimated.timing(landingAnim, { toValue: 0, duration: 750, useNativeDriver: true }),
    ]).start(() => setNewNodeId(null));
  }, [newNodeId, pos, landingAnim]);
```

- [ ] **Step 7: Render the landing animation ring in the fixed overlay**

Inside the fixed overlay `<View style={StyleSheet.absoluteFill} pointerEvents="box-none">`, find the node touch targets section and add the landing animation ring just before the closing `</View>` of the pannable area (after the touch targets `</View>`). Insert after the closing of the touch targets `View` and before the closing of `RNAnimated.View`:

Actually, add this just before the `{/* ── Fixed overlay ── */}` comment (it should be inside the pannable area View but outside the SVG, at the same level as the touch targets View):

Find:

```typescript
        </View>
      </RNAnimated.View>

      {/* ── Fixed overlay ── */}
```

Replace with:

```typescript
        </View>

        {/* ── New node landing animation ── */}
        {newNodeId && pos[newNodeId] && (() => {
          const p = pos[newNodeId]!;
          const screenX = (p.x - vbPos.x) * zoom;
          const screenY = (p.y - vbPos.y) * zoom;
          const ringSize = 44;
          const ringScale = landingAnim.interpolate({
            inputRange: [0, 0.4, 1],
            outputRange: [0.5, 2.4, 3.8],
          });
          const ringOpacityAnim = landingAnim.interpolate({
            inputRange: [0, 0.25, 1],
            outputRange: [0, 0.55, 0],
          });
          return (
            <RNAnimated.View
              pointerEvents="none"
              style={{
                position: 'absolute',
                width: ringSize,
                height: ringSize,
                borderRadius: ringSize / 2,
                borderWidth: 1.5,
                borderColor: c.text,
                left: screenX - ringSize / 2,
                top: screenY - ringSize / 2,
                transform: [{ scale: ringScale }],
                opacity: ringOpacityAnim,
              }}
            />
          );
        })()}

      </RNAnimated.View>

      {/* ── Fixed overlay ── */}
```

- [ ] **Step 8: Verify TypeScript compiles in the mobile project**

```bash
cd "/Users/aaronpinto/Desktop/Intellectual App V2/mobile" && npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 9: Run all unit tests to confirm nothing is broken**

```bash
cd "/Users/aaronpinto/Desktop/Intellectual App V2" && npm run test:unit
```

Expected: all tests PASS.

- [ ] **Step 10: Commit**

```bash
git add mobile/app/(tabs)/index.tsx mobile/types/api.ts
git commit -m "feat: rework post-capture screen with connections, thread context, recommendations, and landing animation"
```

---

## Task 6: Smoke test the full flow

- [ ] **Step 1: Start the backend**

```bash
cd "/Users/aaronpinto/Desktop/Intellectual App V2" && npm run db:up && npm run dev
```

Expected: server starts on localhost:3000 with no errors.

- [ ] **Step 2: Start the mobile app**

In a new terminal:

```bash
cd "/Users/aaronpinto/Desktop/Intellectual App V2/mobile" && EXPO_NO_DOCKER=1 npx expo start --ios -c
```

- [ ] **Step 3: Capture a link and verify the new StepThree**

1. Tap the `+` FAB on the map screen
2. Enter a URL (e.g., a Wikipedia article on consciousness), tap next
3. Enter an optional reaction, tap commit
4. Verify StepThree shows:
   - The title of the capture
   - If this is capture N>=2 on a topic: "capture N on [topic]" thread context line
   - `CONNECTED TO_` section with edge labels if related items exist
   - `WHERE TO GO NEXT_` section with 3 recommendations (title, author, why)

- [ ] **Step 4: Verify the map landing animation**

1. After committing, close the capture modal (tap "← map")
2. The map should briefly show a pulsing ring expanding outward from the new node's position
3. The ring should expand and fade over ~1.2 seconds, then disappear

- [ ] **Step 5: Verify graceful degradation with no OPENAI_API_KEY**

Remove `OPENAI_API_KEY` from `.env.local` temporarily and restart the backend. Capture a new item. StepThree should show without the `WHERE TO GO NEXT_` section (empty recommendations), without crashing.

Restore `OPENAI_API_KEY` afterwards.
