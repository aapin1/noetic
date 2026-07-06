# Atlas Home Page Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the Atlas (map) home screen: a top-right info panel replacing the lonely point-count text, a calmer breathing-glow FAB animation, multi-select nodes opening the companion (grounded in those nodes) instead of a local connection panel, and a fix for the toolbar icon staying highlighted after canceling a selection.

**Architecture:** Backend gets a small, additive extension to the existing companion reply endpoint (optional `contextItemIds` → focus block in the LLM prompt); the single persistent companion thread is reused, nothing new is persisted. Mobile changes are concentrated in `mobile/app/(tabs)/index.tsx` (Atlas screen) and `mobile/app/companion/index.tsx` (companion screen), following existing patterns in those files exactly (same component style, same theme tokens, same animation primitives).

**Tech Stack:** Next.js 14 API routes + Prisma (backend), Expo 51 / React Native + `Animated` + `expo-router` (mobile), Vitest (backend tests).

## Global Constraints

- Follow `CLAUDE.md`: simplicity first, surgical changes, no speculative abstractions.
- Run `npm run prisma:generate` after any `prisma/schema.prisma` edit — not needed for this plan (no schema changes).
- Mobile has no test framework installed; verification for mobile tasks is `cd mobile && npx tsc --noEmit` plus manual verification in the running app (`cd mobile && EXPO_NO_DOCKER=1 npx expo start --ios -c`).
- Backend tests: `npm run test:unit` (vitest, `src/server`) and `npm run test:integration` (vitest, `tests/integration`, needs `.env.test` / test DB per `npm run db:push:test`).
- The user is concurrently building new onboarding functionality that may touch mobile UI/layout. Keep every change in this plan additive and localized to the files listed per task — do not rename, move, or restructure shared layout files (`app/(tabs)/_layout.tsx`, theme constants, `components/ui/*`) beyond what's specified below.

---

## File Structure

**Backend (companion context grounding):**
- Modify: `src/server/contracts.ts` — add optional `contextItemIds` to `companionReplySchema`.
- Modify: `src/server/cognition/llm.ts` — `generateCompanionResponse` accepts optional `focusBlock`, injects it into the system prompt.
- Modify: `src/server/services/companion.ts` — `addCompanionReply` accepts optional `contextItemIds`, fetches those captures (scoped to the user), builds the focus block.
- Modify: `src/app/api/companion/reply/route.ts` — passes `contextItemIds` through.
- Create: `src/server/companion.test.ts` — unit tests for the new `focusBlock` behavior of `generateCompanionResponse`.
- Modify: `tests/integration/api-routes.test.ts` — route-level coverage for `contextItemIds` passthrough.

**Mobile API client:**
- Modify: `mobile/lib/api.ts` — `companion.reply` gains an optional `contextItemIds` param.

**Mobile companion screen:**
- Modify: `mobile/app/companion/index.tsx` — reads `contextIds`/`contextLabels` route params, shows a "regarding" chip + two suggestion chips, threads `contextItemIds` through every send in the visit.

**Mobile Atlas screen** (`mobile/app/(tabs)/index.tsx`), four independent edits:
- Multi-select → companion: discovery-bar button becomes "open in companion →", navigates with node context; removes the now-dead local `discoveryResult`/`discoveryActive` connection-analysis machinery; fixes the cancel button to also reset `toolMode`.
- Top-right info panel: removes the bottom-left point-count text; adds a new `InfoPanel` component fed by 3 new parallel data fetches.
- FAB breathing glow: replaces the ring-pulse animation with a soft glow-disc breathing animation.

---

### Task 1: Backend — companion context grounding

**Files:**
- Modify: `src/server/contracts.ts`
- Modify: `src/server/cognition/llm.ts`
- Modify: `src/server/services/companion.ts`
- Modify: `src/app/api/companion/reply/route.ts`
- Create: `src/server/companion.test.ts`
- Modify: `tests/integration/api-routes.test.ts`

**Interfaces:**
- Produces: `generateCompanionResponse(args: { contextBlock: string; focusBlock?: string; conversationHistory: {role: "USER"|"COMPANION"; content: string}[]; userMessage: string }): Promise<string | null>`
- Produces: `addCompanionReply(args: { userId: string; content: string; contextItemIds?: string[]; db?: DbClient }): Promise<{ userMessage, companionMessage }>`
- Produces: `companionReplySchema` now validates `{ content: string; contextItemIds?: string[] }`
- Consumed by: Task 2 (mobile API client), Task 3 (companion screen)

- [ ] **Step 1: Write the failing unit test for `generateCompanionResponse`'s focus block**

Create `src/server/companion.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateCompanionResponse } from "@/server/cognition/llm";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("generateCompanionResponse", () => {
  it("returns null when OPENAI_API_KEY is not set", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const result = await generateCompanionResponse({
      contextBlock: "map",
      conversationHistory: [],
      userMessage: "hello",
    });
    expect(result).toBeNull();
  });

  it("includes the focus block in the system prompt when provided", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "The tension is X." } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateCompanionResponse({
      contextBlock: "--- KNOWLEDGE MAP ---\nfull map\n--- END MAP ---",
      focusBlock: '--- FOCUS FOR THIS REPLY ---\n1. "Capture A" — idea A\n2. "Capture B" — idea B\n--- END FOCUS ---',
      conversationHistory: [],
      userMessage: "Find the connection",
    });

    expect(result).toBe("The tension is X.");
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    const systemMessage = body.messages[0].content as string;
    expect(systemMessage).toContain("--- FOCUS FOR THIS REPLY ---");
    expect(systemMessage).toContain("Capture A");
    expect(systemMessage).toContain("Ground your answer specifically in the focus items above");
  });

  it("omits the focus section entirely when no focus block is given", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "General answer." } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await generateCompanionResponse({
      contextBlock: "map",
      conversationHistory: [],
      userMessage: "What's new?",
    });

    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    const systemMessage = body.messages[0].content as string;
    expect(systemMessage).not.toContain("FOCUS FOR THIS REPLY");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit -- src/server/companion.test.ts`
Expected: FAIL — TypeScript error, `focusBlock` does not exist on the argument type of `generateCompanionResponse`.

- [ ] **Step 3: Add `focusBlock` support to `generateCompanionResponse`**

In `src/server/cognition/llm.ts`, find the existing function (around line 1100):

```typescript
export async function generateCompanionResponse(args: {
  contextBlock: string;
  conversationHistory: { role: "USER" | "COMPANION"; content: string }[];
  userMessage: string;
}): Promise<string | null> {
```

Replace with:

```typescript
export async function generateCompanionResponse(args: {
  contextBlock: string;
  focusBlock?: string;
  conversationHistory: { role: "USER" | "COMPANION"; content: string }[];
  userMessage: string;
}): Promise<string | null> {
```

Then find the `systemPrompt` array in the same function:

```typescript
  const systemPrompt = [
    "You are Mneme's knowledge companion — a personal AI with access to the user's knowledge map.",
    "You know every topic they've explored, every capture they've saved (numbered newest-first), their stated intellectual positions, and the connections between captures.",
    "",
    args.contextBlock,
    "",
    "Answer what the user asks. Be direct and specific.",
```

Replace with:

```typescript
  const systemPrompt = [
    "You are Mneme's knowledge companion — a personal AI with access to the user's knowledge map.",
    "You know every topic they've explored, every capture they've saved (numbered newest-first), their stated intellectual positions, and the connections between captures.",
    "",
    args.contextBlock,
    "",
    ...(args.focusBlock
      ? [
          args.focusBlock,
          "",
          "Ground your answer specifically in the focus items above — they are what the user is asking about right now. Use the rest of the knowledge map only for supporting context.",
          "",
        ]
      : []),
    "Answer what the user asks. Be direct and specific.",
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit -- src/server/companion.test.ts`
Expected: PASS (all 3 tests)

- [ ] **Step 5: Add `contextItemIds` to the reply contract**

In `src/server/contracts.ts`, find:

```typescript
export const companionReplySchema = z.object({
  content: z.string().min(1).max(4000),
});
```

Replace with:

```typescript
export const companionReplySchema = z.object({
  content: z.string().min(1).max(4000),
  contextItemIds: z.array(z.string()).max(5).optional(),
});
```

- [ ] **Step 6: Thread `contextItemIds` through `addCompanionReply`**

In `src/server/services/companion.ts`, add a helper right after `buildCompanionContext` (which ends around line 90):

```typescript
async function buildFocusBlock(
  userId: string,
  itemIds: string[],
  db: DbClient,
): Promise<string | undefined> {
  const items = await db.capturedItem.findMany({
    where: { id: { in: itemIds }, userId },
    select: { rawText: true, keyIdea: true, contentItem: { select: { title: true } } },
  });
  if (items.length === 0) return undefined;

  const lines = items.map((it, i) => {
    const title = it.contentItem?.title ?? it.rawText?.slice(0, 80) ?? "Untitled";
    const idea = it.keyIdea ? ` — ${it.keyIdea}` : "";
    return `${i + 1}. "${title}"${idea}`;
  });

  return ["--- FOCUS FOR THIS REPLY ---", ...lines, "--- END FOCUS ---"].join("\n");
}
```

Then find `addCompanionReply`'s signature:

```typescript
export async function addCompanionReply(args: {
  userId: string;
  content: string;
  db?: DbClient;
}) {
```

Replace with:

```typescript
export async function addCompanionReply(args: {
  userId: string;
  content: string;
  contextItemIds?: string[];
  db?: DbClient;
}) {
```

Then find:

```typescript
  const [contextBlock] = await Promise.all([buildCompanionContext(args.userId, db)]);

  const companionContent =
    (await generateCompanionResponse({
      contextBlock,
      conversationHistory: thread.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      userMessage: args.content.trim(),
    })) ?? "That's worth exploring — but push it one step further. What specific connection are you trying to trace?";
```

Replace with:

```typescript
  const [contextBlock, focusBlock] = await Promise.all([
    buildCompanionContext(args.userId, db),
    args.contextItemIds && args.contextItemIds.length > 0
      ? buildFocusBlock(args.userId, args.contextItemIds, db)
      : Promise.resolve(undefined),
  ]);

  const companionContent =
    (await generateCompanionResponse({
      contextBlock,
      focusBlock,
      conversationHistory: thread.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      userMessage: args.content.trim(),
    })) ?? "That's worth exploring — but push it one step further. What specific connection are you trying to trace?";
```

- [ ] **Step 7: Pass `contextItemIds` through the route**

In `src/app/api/companion/reply/route.ts`, replace the whole file with:

```typescript
import { handleRoute, parseJson } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { companionReplySchema } from "@/server/contracts";
import { addCompanionReply } from "@/server/services/companion";

export async function POST(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    const input = await parseJson(request, companionReplySchema);
    return addCompanionReply({
      userId,
      content: input.content,
      contextItemIds: input.contextItemIds,
    });
  }, 201);
}
```

- [ ] **Step 8: Write the failing integration test for the route**

In `tests/integration/api-routes.test.ts`, add `addCompanionReply` to the hoisted mocks block (near the top, alongside `getMemoryTrends`):

```typescript
  addCompanionReply: vi.fn(),
```

Add a new `vi.mock` call near the other service mocks:

```typescript
vi.mock("@/server/services/companion", () => ({
  addCompanionReply,
}));
```

Add the route import alongside the other route imports:

```typescript
import { POST as postCompanionReplyRoute } from "@/app/api/companion/reply/route";
```

Add a new `describe` block at the end of the file:

```typescript
describe("POST /api/companion/reply", () => {
  it("passes contextItemIds through to the service when provided", async () => {
    addCompanionReply.mockResolvedValue({
      userMessage: { id: "msg_1", role: "USER", content: "Find the connection" },
      companionMessage: { id: "msg_2", role: "COMPANION", content: "They both argue X." },
    });

    const response = await postCompanionReplyRoute(
      new Request("http://localhost/api/companion/reply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "Find the connection", contextItemIds: ["item_1", "item_2"] }),
      }),
    );

    expect(addCompanionReply).toHaveBeenCalledWith({
      userId: "user_1",
      content: "Find the connection",
      contextItemIds: ["item_1", "item_2"],
    });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: {
        userMessage: { id: "msg_1", role: "USER", content: "Find the connection" },
        companionMessage: { id: "msg_2", role: "COMPANION", content: "They both argue X." },
      },
    });
  });

  it("omits contextItemIds when not provided", async () => {
    addCompanionReply.mockResolvedValue({
      userMessage: { id: "msg_3", role: "USER", content: "hello" },
      companionMessage: { id: "msg_4", role: "COMPANION", content: "hi" },
    });

    await postCompanionReplyRoute(
      new Request("http://localhost/api/companion/reply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "hello" }),
      }),
    );

    expect(addCompanionReply).toHaveBeenCalledWith({
      userId: "user_1",
      content: "hello",
      contextItemIds: undefined,
    });
  });
});
```

- [ ] **Step 9: Run the full backend unit test suite to verify everything passes**

Run: `npm run test:unit`
Expected: PASS (no regressions; new `companion.test.ts` passes)

- [ ] **Step 10: Run the integration test to verify the route passthrough works**

Run: `npm run test:integration`
Expected: PASS. (If `.env.test` / the test DB isn't set up in this environment, run `npx vitest run tests/integration/api-routes.test.ts -t "companion"` instead — this file's tests mock all services, so it does not require a live database.)

- [ ] **Step 11: Commit**

```bash
git add src/server/contracts.ts src/server/cognition/llm.ts src/server/services/companion.ts src/app/api/companion/reply/route.ts src/server/companion.test.ts tests/integration/api-routes.test.ts
git commit -m "feat(companion): ground replies in explicitly selected captures"
```

---

### Task 2: Mobile API client — pass `contextItemIds` through

**Files:**
- Modify: `mobile/lib/api.ts`

**Interfaces:**
- Consumes: backend contract from Task 1 (`POST /api/companion/reply` body now accepts `contextItemIds?: string[]`)
- Produces: `api.companion.reply(content: string, contextItemIds?: string[]): Promise<{ userMessage: CompanionMessage; companionMessage: CompanionMessage }>`

- [ ] **Step 1: Update the `companion.reply` method**

In `mobile/lib/api.ts`, find:

```typescript
  companion: {
    getThread() {
      return request<CompanionThread>('/api/companion');
    },
    reply(content: string) {
      return request<{ userMessage: CompanionMessage; companionMessage: CompanionMessage }>(
        '/api/companion/reply',
        { method: 'POST', body: JSON.stringify({ content }) },
      );
    },
  },
```

Replace with:

```typescript
  companion: {
    getThread() {
      return request<CompanionThread>('/api/companion');
    },
    reply(content: string, contextItemIds?: string[]) {
      return request<{ userMessage: CompanionMessage; companionMessage: CompanionMessage }>(
        '/api/companion/reply',
        { method: 'POST', body: JSON.stringify({ content, contextItemIds }) },
      );
    },
  },
```

- [ ] **Step 2: Type-check**

Run: `cd mobile && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add mobile/lib/api.ts
git commit -m "feat(mobile): pass contextItemIds through companion reply client"
```

---

### Task 3: Mobile — companion screen shows node context + suggestions

**Files:**
- Modify: `mobile/app/companion/index.tsx`

**Interfaces:**
- Consumes: `api.companion.reply(content, contextItemIds?)` from Task 2. Route params `contextIds` (comma-joined capture ids) and `contextLabels` (comma-joined, comma-stripped labels), both optional, set by Task 4's navigation.
- Produces: no new exports — this is a leaf screen.

- [ ] **Step 1: Read route params and derive context arrays**

In `mobile/app/companion/index.tsx`, find:

```typescript
import { useRouter } from 'expo-router';
```

Replace with:

```typescript
import { useLocalSearchParams, useRouter } from 'expo-router';
```

Find:

```typescript
export default function CompanionScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [thread, setThread] = useState<CompanionThread | null>(null);
```

Replace with:

```typescript
export default function CompanionScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { contextIds, contextLabels } = useLocalSearchParams<{ contextIds?: string; contextLabels?: string }>();

  const contextItemIds = useMemo(
    () => (contextIds ? contextIds.split(',').filter(Boolean) : []),
    [contextIds],
  );
  const contextLabelList = useMemo(
    () => (contextLabels ? contextLabels.split(',').filter(Boolean) : []),
    [contextLabels],
  );
  const [suggestionsUsed, setSuggestionsUsed] = useState(false);

  const [thread, setThread] = useState<CompanionThread | null>(null);
```

Add `useMemo` to the React import — find:

```typescript
import React, { useCallback, useEffect, useRef, useState } from 'react';
```

Replace with:

```typescript
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
```

- [ ] **Step 2: Make `handleSend` accept an optional override (for suggestion taps) and pass context**

Find:

```typescript
  const handleSend = useCallback(async () => {
    const content = reply.trim();
    if (!content || sending) return;

    const optimisticUser: CompanionMessage = {
      id: `optimistic-${Date.now()}`,
      threadId: thread?.id ?? '',
      role: 'USER',
      content,
      createdAt: new Date().toISOString(),
    };

    setReply('');
    setSending(true);
    setMessages((prev) => [...prev, optimisticUser]);

    try {
      const { userMessage, companionMessage } = await api.companion.reply(content);
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== optimisticUser.id),
        userMessage,
        companionMessage,
      ]);
    } catch (e) {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticUser.id));
      setError(e instanceof Error ? e.message : 'Failed to send');
    } finally {
      setSending(false);
    }
  }, [reply, sending, thread?.id]);
```

Replace with:

```typescript
  const handleSend = useCallback(async (overrideText?: string) => {
    const content = (overrideText ?? reply).trim();
    if (!content || sending) return;

    const optimisticUser: CompanionMessage = {
      id: `optimistic-${Date.now()}`,
      threadId: thread?.id ?? '',
      role: 'USER',
      content,
      createdAt: new Date().toISOString(),
    };

    setReply('');
    setSending(true);
    setSuggestionsUsed(true);
    setMessages((prev) => [...prev, optimisticUser]);

    try {
      const { userMessage, companionMessage } = await api.companion.reply(
        content,
        contextItemIds.length > 0 ? contextItemIds : undefined,
      );
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== optimisticUser.id),
        userMessage,
        companionMessage,
      ]);
    } catch (e) {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticUser.id));
      setError(e instanceof Error ? e.message : 'Failed to send');
    } finally {
      setSending(false);
    }
  }, [reply, sending, thread?.id, contextItemIds]);
```

- [ ] **Step 3: Fix the two call sites that invoked `handleSend` directly as an event handler**

Find:

```typescript
              onSubmitEditing={handleSend}
```

Replace with:

```typescript
              onSubmitEditing={() => handleSend()}
```

Find:

```typescript
            <Pressable
              onPress={handleSend}
              disabled={!reply.trim() || sending}
              style={styles.sendButton}
              accessibilityLabel="Send"
              accessibilityRole="button"
            >
```

Replace with:

```typescript
            <Pressable
              onPress={() => handleSend()}
              disabled={!reply.trim() || sending}
              style={styles.sendButton}
              accessibilityLabel="Send"
              accessibilityRole="button"
            >
```

- [ ] **Step 4: Add the "regarding" chip + suggestion chips above the input bar**

Find the closing of the messages `ScrollView` and the start of the input bar:

```typescript
          </ScrollView>

          <View
            style={[
              styles.inputBar,
```

Replace with:

```typescript
          </ScrollView>

          {contextItemIds.length > 0 && !suggestionsUsed && (
            <View style={styles.contextBlock}>
              {contextLabelList.length > 0 && (
                <Text
                  variant="monoSmall"
                  color="muted"
                  style={styles.contextLabel}
                  numberOfLines={1}
                >
                  regarding: {contextLabelList.join(', ')}
                </Text>
              )}
              <View style={styles.suggestionRow}>
                <Pressable
                  onPress={() => handleSend('Find the connection')}
                  style={[styles.suggestionChip, { borderColor: c.border }]}
                >
                  <Text variant="monoSmall" style={{ color: c.text }}>Find the connection</Text>
                </Pressable>
                <Pressable
                  onPress={() => handleSend("What's the tension between these ideas?")}
                  style={[styles.suggestionChip, { borderColor: c.border }]}
                >
                  <Text variant="monoSmall" style={{ color: c.text }}>What&apos;s the tension between these ideas?</Text>
                </Pressable>
              </View>
            </View>
          )}

          <View
            style={[
              styles.inputBar,
```

- [ ] **Step 5: Add the new styles**

Find:

```typescript
const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
```

Replace with:

```typescript
const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  contextBlock: {
    paddingHorizontal: Spacing[5],
    paddingTop: Spacing[3],
  },
  contextLabel: {
    marginBottom: Spacing[2],
  },
  suggestionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[2],
  },
  suggestionChip: {
    borderWidth: 1,
    borderRadius: Radius.full,
    paddingVertical: 6,
    paddingHorizontal: Spacing[3],
  },
```

- [ ] **Step 6: Type-check**

Run: `cd mobile && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 7: Manual verification**

Run `cd mobile && EXPO_NO_DOCKER=1 npx expo start --ios -c`, then:
1. Navigate to `/companion` with no params (e.g. via the existing Socratic FAB fallback, or `router.push('/companion')` from anywhere) — confirm no "regarding" chip or suggestions appear, behavior is unchanged from before.
2. This screen can't be fully exercised standalone until Task 4 wires up navigation with params — defer the "with context" check to Task 4's manual verification.

- [ ] **Step 8: Commit**

```bash
git add mobile/app/companion/index.tsx
git commit -m "feat(mobile): companion screen supports node-context suggestions"
```

---

### Task 4: Mobile — Atlas multi-select opens companion; remove dead discovery-result code; fix cancel bug

**Files:**
- Modify: `mobile/app/(tabs)/index.tsx`

**Interfaces:**
- Consumes: `router.push({ pathname: '/companion', params: { contextIds, contextLabels } })` — read by Task 3's `CompanionScreen`.
- Produces: `openDiscoveryCompanion(): void` (replaces `activateDiscovery`), `clearDiscovery(): void` (simplified, no longer touches `discoveryActive`). `discoveryNodeIds`/`toggleDiscoveryNode` unchanged.

- [ ] **Step 1: Remove the dead `intersect` helper**

Find (around line 102):

```typescript
function intersect<T>(a: Set<T>, b: Set<T>): Set<T> {
  return new Set([...a].filter((x) => b.has(x)));
}

```

Delete it (its only two call sites are removed in Step 2).

- [ ] **Step 2: Replace the discovery-mode state block**

Find this entire block (starts around line 1272):

```typescript
  // ── Discovery mode ─────────────────────────────────────────────
  const [discoveryNodeIds, setDiscoveryNodeIds] = useState<string[]>([]);
  const [discoveryActive, setDiscoveryActive] = useState(false);

  const discoveryResult = useMemo(() => {
    if (!discoveryActive || discoveryNodeIds.length < 2) return null;

    const selectedSet = new Set(discoveryNodeIds);
    const connectedTo: Record<string, Set<string>> = {};

    for (const id of discoveryNodeIds) {
      connectedTo[id] = new Set();
    }

    for (const edge of edges) {
      if (selectedSet.has(edge.fromItemId)) {
        connectedTo[edge.fromItemId]!.add(edge.toItemId);
      }
      if (selectedSet.has(edge.toItemId)) {
        connectedTo[edge.toItemId]!.add(edge.fromItemId);
      }
    }

    // Shared neighbors: connected to ALL selected nodes
    const [firstId, ...restIds] = discoveryNodeIds;
    let sharedNeighbors = connectedTo[firstId!] ?? new Set<string>();
    for (const id of restIds) {
      sharedNeighbors = intersect(sharedNeighbors, connectedTo[id] ?? new Set<string>());
    }
    // Remove the selected nodes themselves from shared neighbors
    for (const id of discoveryNodeIds) sharedNeighbors.delete(id);

    const relevantNodeIds = new Set([...discoveryNodeIds, ...sharedNeighbors]);

    const relevantEdges = edges.filter(
      (e) => relevantNodeIds.has(e.fromItemId) && relevantNodeIds.has(e.toItemId),
    );

    // Shared topics between selected nodes
    const topicSets = discoveryNodeIds.map((id) => {
      const node = nodes.find((n) => n.id === id);
      return new Set(node?.topics.map((t) => t.topicId) ?? []);
    });
    const [firstTopicSet, ...restTopicSets] = topicSets;
    let sharedTopicIds = firstTopicSet ?? new Set<string>();
    for (const ts of restTopicSets) {
      sharedTopicIds = intersect(sharedTopicIds, ts);
    }
    const firstNode = nodes.find((n) => n.id === discoveryNodeIds[0]);
    const sharedTopics = firstNode?.topics.filter((t) => sharedTopicIds.has(t.topicId)) ?? [];

    return {
      nodeIds: relevantNodeIds,
      edges: relevantEdges,
      sharedTopics,
      sharedNeighborCount: sharedNeighbors.size,
      directlyConnected: relevantEdges.some(
        (e) =>
          (e.fromItemId === discoveryNodeIds[0] && e.toItemId === discoveryNodeIds[1]) ||
          (e.fromItemId === discoveryNodeIds[1] && e.toItemId === discoveryNodeIds[0]),
      ),
    };
  }, [discoveryActive, discoveryNodeIds, edges, nodes]);

  const discoveryEdgeKeys = useMemo(() => {
    const s = new Set<string>();
    for (const de of discoveryResult?.edges ?? []) {
      s.add(`${de.fromItemId}:${de.toItemId}`);
      s.add(`${de.toItemId}:${de.fromItemId}`);
    }
    return s;
  }, [discoveryResult]);

  const toggleDiscoveryNode = useCallback((nodeId: string) => {
    setDiscoveryActive(false);
    setDiscoveryNodeIds((prev) => {
      if (prev.includes(nodeId)) return prev.filter((id) => id !== nodeId);
      if (prev.length >= 5) return [...prev.slice(1), nodeId];
      return [...prev, nodeId];
    });
  }, []);

  const activateDiscovery = useCallback(() => {
    if (discoveryNodeIds.length >= 2) {
      setDiscoveryActive(true);
      openDrawer(null);
    }
  }, [discoveryNodeIds.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const clearDiscovery = useCallback(() => {
    setDiscoveryNodeIds([]);
    setDiscoveryActive(false);
  }, []);
```

Replace with:

```typescript
  // ── Discovery mode ─────────────────────────────────────────────
  const [discoveryNodeIds, setDiscoveryNodeIds] = useState<string[]>([]);

  const toggleDiscoveryNode = useCallback((nodeId: string) => {
    setDiscoveryNodeIds((prev) => {
      if (prev.includes(nodeId)) return prev.filter((id) => id !== nodeId);
      if (prev.length >= 5) return [...prev.slice(1), nodeId];
      return [...prev, nodeId];
    });
  }, []);

  const clearDiscovery = useCallback(() => {
    setDiscoveryNodeIds([]);
  }, []);

  const openDiscoveryCompanion = useCallback(() => {
    if (discoveryNodeIds.length < 2) return;
    const labels = discoveryNodeIds
      .map((id) => nodes.find((n) => n.id === id)?.label ?? '')
      .filter(Boolean)
      .map((l) => l.replace(/,/g, ';'));
    router.push({
      pathname: '/companion' as never,
      params: { contextIds: discoveryNodeIds.join(','), contextLabels: labels.join(',') },
    });
    clearDiscovery();
    setToolMode('default');
  }, [discoveryNodeIds, nodes, router, clearDiscovery]);
```

- [ ] **Step 3: Simplify `getNodeOpacity` (drop the now-dead discovery-result dimming branch)**

Find:

```typescript
  const getNodeOpacity = useCallback((node: GraphNode, baseOpacity: number, zoomFade: number) => {
    // Search dimming
    if (hasSearch && !highlightedIds.has(node.id)) {
      return baseOpacity * 0.10 * zoomFade;
    }
    // Discovery dimming (when result is active)
    if (discoveryResult && !discoveryResult.nodeIds.has(node.id)) {
      return baseOpacity * 0.06 * zoomFade;
    }
    // Timeline cutoff (temporal lens)
    if (lensMode === 'temporal') {
      const ts = nodeTimestamps.get(node.id) ?? 0;
      if (ts > timelineCutoffMs) {
        return baseOpacity * 0.08 * zoomFade;
      }
    }
    // Focus dimming
    if (focusedTopicId && !node.topics.some((t) => t.topicId === focusedTopicId)) {
      return baseOpacity * 0.06 * zoomFade;
    }
    return baseOpacity * zoomFade;
  }, [hasSearch, highlightedIds, discoveryResult, lensMode, nodeTimestamps, timelineCutoffMs, focusedTopicId]);
```

Replace with:

```typescript
  const getNodeOpacity = useCallback((node: GraphNode, baseOpacity: number, zoomFade: number) => {
    // Search dimming
    if (hasSearch && !highlightedIds.has(node.id)) {
      return baseOpacity * 0.10 * zoomFade;
    }
    // Timeline cutoff (temporal lens)
    if (lensMode === 'temporal') {
      const ts = nodeTimestamps.get(node.id) ?? 0;
      if (ts > timelineCutoffMs) {
        return baseOpacity * 0.08 * zoomFade;
      }
    }
    // Focus dimming
    if (focusedTopicId && !node.topics.some((t) => t.topicId === focusedTopicId)) {
      return baseOpacity * 0.06 * zoomFade;
    }
    return baseOpacity * zoomFade;
  }, [hasSearch, highlightedIds, lensMode, nodeTimestamps, timelineCutoffMs, focusedTopicId]);
```

- [ ] **Step 4: Simplify the edge render (drop `isDiscoveryEdge`/`discoveryResult` dimming)**

Find:

```typescript
                const isDiscoveryEdge = discoveryEdgeKeys.has(`${e.fromItemId}:${e.toItemId}`);
                const baseOpacity = 0.07 + e.weight * 0.24;
                let edgeOpacity = baseOpacity;
                if (discoveryResult && !isDiscoveryEdge) edgeOpacity = baseOpacity * 0.04;
                if (focusedTopicId) {
                  const fromNode = nodeById.get(e.fromItemId);
                  const toNode = nodeById.get(e.toItemId);
                  const fromInFocus = fromNode?.topics.some((t) => t.topicId === focusedTopicId);
                  const toInFocus = toNode?.topics.some((t) => t.topicId === focusedTopicId);
                  if (!fromInFocus && !toInFocus) edgeOpacity *= 0.08;
                }

                return (
                  <Line
                    key={`e${i}`}
                    x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                    stroke={isDiscoveryEdge ? '#7EC8A0' : MAP_LINE}
                    strokeWidth={isDiscoveryEdge ? 1.2 : 0.7}
                    strokeOpacity={edgeOpacity}
                  />
                );
```

Replace with:

```typescript
                const baseOpacity = 0.07 + e.weight * 0.24;
                let edgeOpacity = baseOpacity;
                if (focusedTopicId) {
                  const fromNode = nodeById.get(e.fromItemId);
                  const toNode = nodeById.get(e.toItemId);
                  const fromInFocus = fromNode?.topics.some((t) => t.topicId === focusedTopicId);
                  const toInFocus = toNode?.topics.some((t) => t.topicId === focusedTopicId);
                  if (!fromInFocus && !toInFocus) edgeOpacity *= 0.08;
                }

                return (
                  <Line
                    key={`e${i}`}
                    x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                    stroke={MAP_LINE}
                    strokeWidth={0.7}
                    strokeOpacity={edgeOpacity}
                  />
                );
```

- [ ] **Step 5: Simplify the node render (drop `isDiscoveryRelevant`, keep `isDiscoverySelected`)**

Find:

```typescript
                const isHighlighted = hasSearch && highlightedIds.has(node.id);
                const isDiscoverySelected = discoveryNodeIds.includes(node.id);
                const isDiscoveryRelevant = discoveryResult?.nodeIds.has(node.id);
```

Replace with:

```typescript
                const isHighlighted = hasSearch && highlightedIds.has(node.id);
                const isDiscoverySelected = discoveryNodeIds.includes(node.id);
```

Find:

```typescript
                const glowR = isHighlighted || isDiscoverySelected ? baseR * 9 : baseR * 5.5;
                const glowOp = (isHighlighted || isDiscoverySelected) ? 0.12 : (isDiscoveryRelevant ? 0.10 : 0.03);
                const innerGlowOp = (isHighlighted || isDiscoverySelected) ? 0.28 : (isDiscoveryRelevant ? 0.20 : 0.09);
```

Replace with:

```typescript
                const glowR = isHighlighted || isDiscoverySelected ? baseR * 9 : baseR * 5.5;
                const glowOp = (isHighlighted || isDiscoverySelected) ? 0.12 : 0.03;
                const innerGlowOp = (isHighlighted || isDiscoverySelected) ? 0.28 : 0.09;
```

- [ ] **Step 6: Update the discovery bar button (text + navigation + cancel-resets-toolMode fix)**

Find:

```typescript
        {/* Discover mode: selection count + Find button */}
        {toolMode === 'discover' && discoveryNodeIds.length > 0 && !showCapture && !drawerVisible && (
          <View style={[styles.discoveryBar, { bottom: TAB_H + Spacing[5] + FAB_SIZE + Spacing[3] }]} pointerEvents="box-none">
            <View style={[styles.discoveryPill, { backgroundColor: 'rgba(10,10,10,0.88)', borderColor: 'rgba(255,255,255,0.12)' }]} pointerEvents="auto">
              <Text style={[styles.discoveryCount, { color: 'rgba(236,236,236,0.5)' }]}>
                {discoveryNodeIds.length} selected
              </Text>
              {discoveryNodeIds.length >= 2 && (
                <>
                  <View style={[styles.discoverySep, { backgroundColor: 'rgba(255,255,255,0.1)' }]} />
                  <Pressable onPress={activateDiscovery} hitSlop={8}>
                    <Text style={[styles.discoveryAction, { color: '#7EC8A0' }]}>
                      find connection →
                    </Text>
                  </Pressable>
                </>
              )}
              <View style={[styles.discoverySep, { backgroundColor: 'rgba(255,255,255,0.1)' }]} />
              <Pressable onPress={clearDiscovery} hitSlop={8}>
                <Text style={[styles.discoveryCount, { color: 'rgba(236,236,236,0.3)' }]}>✕</Text>
              </Pressable>
            </View>
          </View>
        )}
```

Replace with:

```typescript
        {/* Discover mode: selection count + open-in-companion button */}
        {toolMode === 'discover' && discoveryNodeIds.length > 0 && !showCapture && !drawerVisible && (
          <View style={[styles.discoveryBar, { bottom: TAB_H + Spacing[5] + FAB_SIZE + Spacing[3] }]} pointerEvents="box-none">
            <View style={[styles.discoveryPill, { backgroundColor: 'rgba(10,10,10,0.88)', borderColor: 'rgba(255,255,255,0.12)' }]} pointerEvents="auto">
              <Text style={[styles.discoveryCount, { color: 'rgba(236,236,236,0.5)' }]}>
                {discoveryNodeIds.length} selected
              </Text>
              {discoveryNodeIds.length >= 2 && (
                <>
                  <View style={[styles.discoverySep, { backgroundColor: 'rgba(255,255,255,0.1)' }]} />
                  <Pressable onPress={openDiscoveryCompanion} hitSlop={8}>
                    <Text style={[styles.discoveryAction, { color: '#7EC8A0' }]}>
                      open in companion →
                    </Text>
                  </Pressable>
                </>
              )}
              <View style={[styles.discoverySep, { backgroundColor: 'rgba(255,255,255,0.1)' }]} />
              <Pressable onPress={() => { clearDiscovery(); setToolMode('default'); }} hitSlop={8}>
                <Text style={[styles.discoveryCount, { color: 'rgba(236,236,236,0.3)' }]}>✕</Text>
              </Pressable>
            </View>
          </View>
        )}
```

- [ ] **Step 7: Remove the drawer's dead "Discovery result" block**

Find this entire block:

```typescript
                {/* Discovery result */}
                {discoveryResult && discoveryActive && (
                  <View>
                    <Text variant="monoSmall" style={{ color: c.faint, marginBottom: Spacing[3], letterSpacing: 1.5, textTransform: 'uppercase' }}>
                      connection
                    </Text>
                    <Text variant="h3" style={{ marginBottom: Spacing[2] }}>
                      {discoveryNodeIds.length} ideas
                    </Text>
                    <View style={[styles.drawerHairline, { backgroundColor: c.border }]} />

                    {discoveryResult.directlyConnected && (
                      <Text variant="monoSmall" color="muted" style={{ marginTop: Spacing[3], marginBottom: Spacing[2] }}>
                        directly connected
                      </Text>
                    )}

                    {discoveryResult.sharedNeighborCount > 0 && (
                      <Text variant="monoSmall" color="muted" style={{ marginBottom: Spacing[2] }}>
                        {discoveryResult.sharedNeighborCount} shared {discoveryResult.sharedNeighborCount === 1 ? 'neighbor' : 'neighbors'}
                      </Text>
                    )}

                    {discoveryResult.sharedTopics.length > 0 ? (
                      <View style={{ marginTop: Spacing[2] }}>
                        <Text variant="monoSmall" style={{ color: c.faint, marginBottom: Spacing[2] }}>shared topics</Text>
                        {discoveryResult.sharedTopics.map((t) => (
                          <Text key={t.topicId} variant="body" color="secondary" style={{ marginBottom: Spacing[1] }}>
                            {t.name}
                          </Text>
                        ))}
                      </View>
                    ) : (
                      <Text variant="monoSmall" color="muted" style={{ marginTop: Spacing[3] }}>
                        no shared topics yet. these ideas sit in different parts of the map.
                      </Text>
                    )}

                    {discoveryResult.sharedNeighborCount === 0 && !discoveryResult.directlyConnected && (
                      <Text variant="monoSmall" color="muted" style={{ marginTop: Spacing[3] }}>
                        no direct link yet. save more around these and one may show up.
                      </Text>
                    )}

                    <View style={[styles.drawerHairline, { backgroundColor: c.border, marginTop: Spacing[4] }]} />
                    <Pressable onPress={() => { clearDiscovery(); closeDrawer(); }} style={{ marginTop: Spacing[4] }}>
                      <Text variant="monoSmall" color="muted">clear selection →</Text>
                    </Pressable>
                  </View>
                )}

                {/* Cluster detail */}
                {drawerCluster && !selectedNode && !discoveryActive && (
```

Replace with:

```typescript
                {/* Cluster detail */}
                {drawerCluster && !selectedNode && (
```

- [ ] **Step 8: Drop the last `discoveryActive` reference**

Find:

```typescript
                {/* Node detail */}
                {selectedNode && !discoveryActive && (
```

Replace with:

```typescript
                {/* Node detail */}
                {selectedNode && (
```

- [ ] **Step 9: Type-check**

Run: `cd mobile && npx tsc --noEmit`
Expected: no errors. In particular, confirm there are zero remaining references to `discoveryActive`, `discoveryResult`, `discoveryEdgeKeys`, `activateDiscovery`, or `intersect`:

Run: `cd mobile && grep -n "discoveryActive\|discoveryResult\|discoveryEdgeKeys\|activateDiscovery\|intersect(" "app/(tabs)/index.tsx"`
Expected: no output.

- [ ] **Step 10: Manual verification**

Run `cd mobile && EXPO_NO_DOCKER=1 npx expo start --ios -c`, then on the Atlas tab:
1. Tap the discover (crosshair) toolbar icon, select 2+ nodes — confirm the bar reads "N selected" / "open in companion →".
2. Tap "open in companion →" — confirm it navigates to the companion screen, shows a "regarding: ..." chip with the two node labels, and the two suggestion chips ("Find the connection", "What's the tension between these ideas?").
3. Tap a suggestion chip — confirm it sends immediately and a grounded reply comes back referencing the two captures; confirm the suggestion chips disappear after sending.
4. Go back to Atlas — confirm the map/selection has reset and the crosshair icon is no longer highlighted.
5. Re-enter discover mode, select 2+ nodes, tap the ✕ to cancel — confirm the crosshair icon immediately stops being highlighted (this is the bug fix; previously it stayed gray until tapped again).

- [ ] **Step 11: Commit**

```bash
git add "mobile/app/(tabs)/index.tsx"
git commit -m "feat(mobile): multi-select opens companion with node context; fix stuck toolbar highlight"
```

---

### Task 5: Mobile — Atlas top-right info panel

**Files:**
- Modify: `mobile/app/(tabs)/index.tsx`

**Interfaces:**
- Consumes: `api.memory.intelligence()`, `api.memory.trends({ window })`, `api.social.pulse()` (all pre-existing, unchanged), `router.push` (pre-existing).
- Produces: `InfoPanel` component (local to this file, not exported).

- [ ] **Step 1: Import the new response types**

Find:

```typescript
import type { CaptureKind, CapturePreflight, MemoryGraphResponse } from '@/types/api';
```

Replace with:

```typescript
import type {
  CaptureKind,
  CapturePreflight,
  MemoryGraphResponse,
  MemoryTrendsResponse,
  PersonalIntelligenceResponse,
  PulseResponse,
} from '@/types/api';
```

- [ ] **Step 2: Add the `InfoPanel` component**

Find the end of the `Toolbar` component's styles (right before the "Timeline scrubber" section comment):

```typescript
const tb = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: Radius.full,
    overflow: 'hidden',
  },
  btn: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sep: { width: 1, height: 18 },
});
```

Add immediately after it:

```typescript
// ── Info panel (top-right map summary) ────────────────────────────

interface ExcitingLine {
  text: string;
  route: string;
}

function InfoPanel({
  top, pointCount, topicCount, connectionCount, tensionCount, exciting, onNavigate,
}: {
  top: number;
  pointCount: number;
  topicCount: number;
  connectionCount: number;
  tensionCount: number;
  exciting: ExcitingLine | null;
  onNavigate: (route: string) => void;
}) {
  return (
    <View style={[infoPanelStyles.wrap, { top }]} pointerEvents="box-none">
      <Text variant="monoSmall" style={infoPanelStyles.line}>
        {pointCount} {pointCount === 1 ? 'point' : 'points'}
      </Text>
      <Text variant="monoSmall" style={infoPanelStyles.line}>
        {topicCount} {topicCount === 1 ? 'topic' : 'topics'}
      </Text>
      {connectionCount > 0 && (
        <Text variant="monoSmall" style={infoPanelStyles.line}>
          {connectionCount} {connectionCount === 1 ? 'connection' : 'connections'}
        </Text>
      )}
      {tensionCount > 0 && (
        <Pressable onPress={() => onNavigate('/(tabs)/mind')} hitSlop={6}>
          <Text variant="monoSmall" style={infoPanelStyles.exciting}>
            {tensionCount} {tensionCount === 1 ? 'tension' : 'tensions'} to explore →
          </Text>
        </Pressable>
      )}
      {exciting && (
        <Pressable onPress={() => onNavigate(exciting.route)} hitSlop={6}>
          <Text variant="monoSmall" style={infoPanelStyles.exciting}>{exciting.text}</Text>
        </Pressable>
      )}
    </View>
  );
}

const infoPanelStyles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    right: Spacing[6],
    alignItems: 'flex-end',
  },
  line: {
    color: 'rgba(236,236,236,0.28)',
    marginBottom: 4,
  },
  exciting: {
    color: 'rgba(236,236,236,0.5)',
    marginBottom: 4,
  },
});
```

- [ ] **Step 3: Fetch the 3 additional data sources and derive the stats**

Find:

```typescript
  // Account creation date anchors the temporal timeline's start.
  const { data: profileData } = useApiQuery(() => api.profile.me(), []);
  const accountCreatedMs = useMemo(() => {
    const created = profileData?.profile.createdAt;
    return created ? new Date(created).getTime() : null;
  }, [profileData]);

  const nodes = graphData?.nodes ?? [];
  const edges = graphData?.edges ?? [];
  const clusters = graphData?.clusters ?? [];
```

Replace with:

```typescript
  // Account creation date anchors the temporal timeline's start.
  const { data: profileData } = useApiQuery(() => api.profile.me(), []);
  const accountCreatedMs = useMemo(() => {
    const created = profileData?.profile.createdAt;
    return created ? new Date(created).getTime() : null;
  }, [profileData]);

  // Info panel: independent, non-blocking fetches — each line appears as
  // soon as its own data resolves, without gating on the others.
  const { data: intelligenceData } = useApiQuery(() => api.memory.intelligence(), []);
  const { data: trendsData } = useApiQuery(() => api.memory.trends({ window: 'week' }), []);
  const { data: pulseData } = useApiQuery(() => api.social.pulse(), []);

  const nodes = graphData?.nodes ?? [];
  const edges = graphData?.edges ?? [];
  const clusters = graphData?.clusters ?? [];

  const topicCount = useMemo(() => {
    const ids = new Set<string>();
    for (const n of nodes) for (const t of n.topics) ids.add(t.topicId);
    return ids.size;
  }, [nodes]);

  const tensionCount = intelligenceData?.contradictionCards.length ?? 0;

  const excitingLine = useMemo((): ExcitingLine | null => {
    const friendWithRecent = pulseData?.friends.find((f) => {
      const latest = f.latest[0];
      return latest && Date.now() - new Date(latest.capturedAt).getTime() < DAY_MS;
    });
    if (friendWithRecent) {
      return { text: `${friendWithRecent.user.displayName} just added something →`, route: '/(tabs)/pulse' };
    }
    const risingTheme = trendsData?.shifts
      .filter((s) => s.delta > 0)
      .sort((a, b) => b.delta - a.delta)[0];
    if (risingTheme) {
      return { text: `${risingTheme.name} is rising this week →`, route: '/(tabs)/trends' };
    }
    return null;
  }, [pulseData, trendsData]);
```

- [ ] **Step 4: Remove the bottom-left point-count text and render `InfoPanel` instead**

Find:

```typescript
        {/* Node count (bottom-left) */}
        {nodes.length > 0 && !showCapture && !drawerVisible && lensMode !== 'temporal' && (
          <View
            style={[styles.mapMeta, { bottom: TAB_H + Spacing[5] }]}
            pointerEvents="none"
          >
            <Text variant="monoSmall" style={{ color: 'rgba(236,236,236,0.20)' }}>
              {nodes.length} {nodes.length === 1 ? 'point' : 'points'}
            </Text>
          </View>
        )}
```

Replace with nothing (delete this block).

Find the `<InfoModal .../>` element (right after the header `View` closes):

```typescript
        <InfoModal
          visible={infoVisible}
          onClose={() => setInfoVisible(false)}
          title="atlas"
          body="Your knowledge map. Every node is something you saved. Lines appear when ideas share a topic, contradict each other, or grow out of one another. Switch lenses to sort the map by meaning, time, or source."
        />
```

Replace with:

```typescript
        <InfoModal
          visible={infoVisible}
          onClose={() => setInfoVisible(false)}
          title="atlas"
          body="Your knowledge map. Every node is something you saved. Lines appear when ideas share a topic, contradict each other, or grow out of one another. Switch lenses to sort the map by meaning, time, or source."
        />

        {/* Info panel (top-right map summary) */}
        {nodes.length > 0 && !showCapture && !drawerVisible && lensMode !== 'temporal' &&
          toolMode !== 'search' && !(toolMode === 'discover' && discoveryNodeIds.length > 0) && (
          <InfoPanel
            top={insets.top + 80}
            pointCount={nodes.length}
            topicCount={topicCount}
            connectionCount={edges.length}
            tensionCount={tensionCount}
            exciting={excitingLine}
            onNavigate={(route) => router.push(route as never)}
          />
        )}
```

- [ ] **Step 5: Remove the now-unused `mapMeta` style**

Find:

```typescript
  mapMeta: {
    position: 'absolute',
    left: Spacing[5],
    flexDirection: 'row',
    alignItems: 'center',
  },
```

Delete it.

- [ ] **Step 6: Type-check**

Run: `cd mobile && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Manual verification**

With the Expo dev server running on the Atlas tab:
1. Confirm the bottom-left point count is gone.
2. Confirm a right-aligned panel appears below the header buttons showing points/topics, and connections (once the graph has edges).
3. Wait a moment and confirm a "N tensions to explore →" line appears if the account has contradiction cards (check via the Mind tab first to know if any exist) — tapping it navigates to Mind.
4. Confirm at most one of the friend-activity / rising-theme lines appears, and tapping it navigates to Pulse or Drift respectively.
5. Switch to the "time" lens — confirm the panel disappears (matches the pre-existing timeline-rail collision rule). Switch to discover mode and select a node — confirm the panel disappears once the discovery bar shows; reappears when selection is cleared.

- [ ] **Step 8: Commit**

```bash
git add "mobile/app/(tabs)/index.tsx"
git commit -m "feat(mobile): add top-right Atlas info panel, remove bottom-left point count"
```

---

### Task 6: Mobile — FAB breathing glow animation

**Files:**
- Modify: `mobile/app/(tabs)/index.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing consumed elsewhere — purely visual, self-contained.

- [ ] **Step 1: Import `Easing`**

Find:

```typescript
import {
  Alert,
  Animated as RNAnimated,
  Dimensions,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
```

Replace with:

```typescript
import {
  Alert,
  Animated as RNAnimated,
  Dimensions,
  Easing,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
```

- [ ] **Step 2: Change the animation loop to a sine-eased breathing pulse**

Find:

```typescript
  useEffect(() => {
    const loop = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(fabPulse, { toValue: 1, duration: 2600, useNativeDriver: true }),
        RNAnimated.timing(fabPulse, { toValue: 0, duration: 2600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [fabPulse]);
```

Replace with:

```typescript
  useEffect(() => {
    const loop = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(fabPulse, {
          toValue: 1, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true,
        }),
        RNAnimated.timing(fabPulse, {
          toValue: 0, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [fabPulse]);
```

- [ ] **Step 3: Replace the ring interpolation with a glow interpolation**

Find:

```typescript
  const ringOpacity = fabPulse.interpolate({ inputRange: [0, 1], outputRange: [0.0, 0.4] });
  const ringScale = fabPulse.interpolate({ inputRange: [0, 1], outputRange: [1.0, 1.75] });
```

Replace with:

```typescript
  const glowOpacity = fabPulse.interpolate({ inputRange: [0, 1], outputRange: [0.0, 0.22] });
  const glowScale = fabPulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.1] });
```

- [ ] **Step 4: Update the FAB render to use the filled glow disc instead of the bordered ring**

Find:

```typescript
        {!showCapture && !drawerVisible && (
          <View style={[styles.fabWrap, { bottom: TAB_H + Spacing[5] }]} pointerEvents="box-none">
            <RNAnimated.View
              style={[styles.fabRing, { borderColor: MAP_NODE, opacity: ringOpacity, transform: [{ scale: ringScale }] }]}
              pointerEvents="none"
            />
            <Pressable
              onPress={openCapture}
              style={[styles.fab, { backgroundColor: MAP_NODE }]}
              accessibilityLabel="Capture new memory"
              accessibilityRole="button"
            >
              <Text style={[styles.fabPlus, { color: '#060606' }]}>+</Text>
            </Pressable>
          </View>
        )}
```

Replace with:

```typescript
        {!showCapture && !drawerVisible && (
          <View style={[styles.fabWrap, { bottom: TAB_H + Spacing[5] }]} pointerEvents="box-none">
            <RNAnimated.View
              style={[styles.fabGlow, { backgroundColor: MAP_NODE, opacity: glowOpacity, transform: [{ scale: glowScale }] }]}
              pointerEvents="none"
            />
            <Pressable
              onPress={openCapture}
              style={[styles.fab, { backgroundColor: MAP_NODE }]}
              accessibilityLabel="Capture new memory"
              accessibilityRole="button"
            >
              <Text style={[styles.fabPlus, { color: '#060606' }]}>+</Text>
            </Pressable>
          </View>
        )}
```

- [ ] **Step 5: Replace the `fabRing` style with `fabGlow`**

Find:

```typescript
  fabRing: {
    position: 'absolute',
    width: FAB_SIZE, height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    borderWidth: 1,
  },
```

Replace with:

```typescript
  fabGlow: {
    position: 'absolute',
    width: FAB_SIZE * 1.6, height: FAB_SIZE * 1.6,
    borderRadius: (FAB_SIZE * 1.6) / 2,
  },
```

- [ ] **Step 6: Type-check**

Run: `cd mobile && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Manual verification**

On the Atlas tab, watch the "+" button for ~10 seconds: confirm there's a soft, borderless glow behind it that smoothly grows and fades (no hard ring shape expanding outward), repeating continuously.

- [ ] **Step 8: Commit**

```bash
git add "mobile/app/(tabs)/index.tsx"
git commit -m "feat(mobile): replace FAB ring pulse with breathing glow animation"
```

---

## Self-Review Notes

- **Spec coverage:** (a) info panel → Task 5. (b) FAB animation → Task 6. (c) multi-select → companion → Tasks 1-4. (d) stuck highlight bug → Task 4 Step 6. All four spec sections covered.
- **Placeholder scan:** none found — every step has complete code.
- **Type consistency:** `contextItemIds`/`contextIds`/`contextLabels` naming is consistent across Tasks 1-4; `openDiscoveryCompanion`/`clearDiscovery` signatures match between definition (Task 4 Step 2) and call sites (Task 4 Step 6); `ExcitingLine`/`InfoPanel` props match between definition and usage (Task 5 Steps 2-4).
- **Task independence:** Tasks 5 and 6 don't depend on Tasks 1-4 and could be done in parallel with them if using subagent-driven development; Task 3 depends on Task 2; Task 4 depends on Task 3 only for full manual end-to-end verification (its code changes are independent).
