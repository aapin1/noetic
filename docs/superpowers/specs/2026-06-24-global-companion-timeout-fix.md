# Spec: Global AI Companion + Capture Pipeline Timeout Fix

**Date:** 2026-06-24  
**Status:** Approved

---

## 1. Problem Statement

Two independent issues:

**A. Prisma transaction timeout on capture:**  
`polishInsights` (an OpenAI call) runs inside a Prisma `$transaction`. Prisma's default transaction timeout is 5 seconds. OpenAI responses take 7k+ ms under normal load, causing the transaction to abort and the capture to fail.

**B. No global knowledge companion:**  
The existing Socratic companion (`/socratic/[topicId]`) is scoped to a single topic — it knows at most 8 captures from that topic and cannot answer cross-topic questions like "how does my quantum mechanics capture relate to my thinking on determinism?"

---

## 2. Timeout Fix

### Root cause
In `src/server/services/cognition.ts`, `captureItem()` runs `polishInsights()` inside `prisma.$transaction()`. The Prisma client's default `transactionOptions.timeout` is 5000ms. OpenAI regularly exceeds this.

### Fix
Move all LLM work **before** the transaction. The transaction should contain only DB writes.

**Before:**
```
classifyTopics (LLM #1)
  → computeNeighbors (DB scan)
    → prisma.$transaction {
        DB creates
        ensureUserPreference
        draftInsights (pure)
        polishInsights (LLM #2) ← PROBLEM
        insight creates
      }
      ∥ generateRecommendations (LLM #3)
```

**After:**
```
[ensureUserPreference (DB read), classifyTopics (LLM #1)] ← parallel
  → computeNeighbors (DB scan)
    → draftInsights (pure)
      → polishInsights (LLM #2)  ← outside transaction
        → prisma.$transaction {   ← pure DB writes only
            captured item create
            insight creates (using pre-computed polishedDrafts)
            edge creates
            event creates
          }
          ∥ generateRecommendations (LLM #3)
```

**Also:** Add `max_tokens` caps to all LLM calls in `llm.ts` to reduce generation time:
- `extractSemanticTopics`: `max_tokens: 200` (JSON with 3–7 labels)
- `polishInsights`: `max_tokens: 600` (3 insights × headline + body + question)
- `generateRecommendations`: `max_tokens: 400` (3 recommendations)
- `generateContradictionTension`: `max_tokens: 150`
- `generateThreadSynthesis`: `max_tokens: 200`
- `generateConvergenceSignal`: `max_tokens: 150`
- `evaluatePositionTension`: `max_tokens: 150`
- `generateSocraticOpening`: `max_tokens: 200`
- `generateSocraticResponse`: `max_tokens: 200`

These caps don't sacrifice quality — the prompts explicitly ask for 1–3 sentences. Uncapped calls were wasting time generating padding tokens.

### Files changed
- `src/server/services/cognition.ts` — refactor `captureItem()`
- `src/server/cognition/llm.ts` — add `max_tokens` to all OpenAI calls

---

## 3. Global AI Companion

### 3.1 Schema

Two new Prisma models in `prisma/schema.prisma`:

```prisma
model CompanionThread {
  id        String             @id @default(cuid())
  userId    String             @unique
  user      User               @relation(fields: [userId], references: [id], onDelete: Cascade)
  messages  CompanionMessage[]
  createdAt DateTime           @default(now())
  updatedAt DateTime           @updatedAt
}

model CompanionMessage {
  id        String          @id @default(cuid())
  threadId  String
  thread    CompanionThread @relation(fields: [threadId], references: [id], onDelete: Cascade)
  role      SocraticRole
  content   String
  createdAt DateTime        @default(now())
}
```

`SocraticRole` enum already exists in Prisma (`USER` | `COMPANION`). Reuse it — the companion roles are identical.

Run `npm run db:push` then `npm run prisma:generate`.

### 3.2 Context loader

`buildCompanionContext(userId, db)` fetches in parallel:
1. All `UserTopic` rows for the user (topic name + capture count via `_count`)
2. All `UserPosition` rows (topic name + statement)
3. Up to 100 `CapturedItem` rows ordered by `capturedAt desc` (fields: `id`, `title` derived, `keyIdea`)
4. All `MemoryEdge` rows for the user (`fromItemId`, `toItemId`, `type`)

Serialized into a compact string passed as the system prompt context block:

```
KNOWLEDGE MAP
Topics (N): quantum mechanics (8), determinism (12), free will (5), ...

Positions:
- determinism: "You appear to hold that..."
- free will: "..."

Captures (numbered newest-first):
1. "A lecture on quantum mechanics" — observer effect undermines classical determinism
2. "Alex O'Connor on free will" — compatibilism requires redefining 'could have done otherwise'
...

Connections:
- #1 CONTRADICTS #2
- #4 EXTENDS #7
```

This context is ~1–3k tokens for a typical user with 50–100 captures. Cost at gpt-4o-mini rates: ~$0.0005 per message.

### 3.3 LLM function

`generateCompanionResponse(args)` added to `src/server/cognition/llm.ts`:

```ts
args: {
  contextBlock: string          // from buildCompanionContext
  conversationHistory: { role: 'USER' | 'COMPANION'; content: string }[]
  userMessage: string
}
returns: Promise<string | null>
```

System prompt:
```
You are Mneme's knowledge companion. You have full access to the user's personal
knowledge map — every topic they've explored, every capture they've saved, their stated
positions, and the semantic connections between captures.

When asked how items connect: explain the specific intellectual bridge clearly (2–3
sentences), then ask one targeted follow-up question that zooms in on the most
interesting tension or implication.

For open questions: answer directly from what you know about their map, then probe once.

Rules:
- Reference captures by their numbered ID when relevant: "Capture #4..."
- Do not start with affirmations or "Great question".
- 3–5 sentences max before the follow-up question.
- Be specific — name the concept, argument, or mechanism, not just the category.
```

Model: `gpt-4o-mini`, `temperature: 0.5`, `max_tokens: 400`.

### 3.4 API routes

**`GET /api/companion`**
- Auth: `requireRequestUserId`
- Service: `getOrCreateCompanionThread(userId)` — find unique by userId, or create with no messages
- Response: `{ id, userId, messages: CompanionMessage[], createdAt, updatedAt }`

**`POST /api/companion/reply`**
- Auth: `requireRequestUserId`
- Body: `{ content: string }` (validated via Zod, same pattern as `socraticReplySchema`)
- Service: `addCompanionReply(userId, content)`
  1. Load thread (404 if not found — caller must GET first)
  2. `buildCompanionContext(userId)`
  3. `generateCompanionResponse({ contextBlock, conversationHistory, userMessage })`
  4. Persist user message + companion message in a `$transaction`
  5. Return `{ userMessage, companionMessage }`
- Status 201

### 3.5 Service

`src/server/services/companion.ts` — two exported functions:
- `getOrCreateCompanionThread(args: { userId, db? })`
- `addCompanionReply(args: { userId, content, db? })`

Follows the same pattern as `src/server/services/socratic.ts`.

### 3.6 Mobile screen

**New file:** `mobile/app/companion/index.tsx`

Identical UI to `mobile/app/socratic/[topicId].tsx` except:
- No `topicId` param — uses `/api/companion` and `/api/companion/reply`
- Header: `"companion · your knowledge map"`
- Empty state: `"Ask anything about your knowledge map."`

**API client additions** to `mobile/lib/api.ts`:
```ts
companion: {
  getThread() → CompanionThread
  reply(content: string) → { userMessage: CompanionMessage; companionMessage: CompanionMessage }
}
```

**Type additions** to `mobile/types/api.ts`:
```ts
CompanionThread: { id, userId, messages: CompanionMessage[], createdAt, updatedAt }
CompanionMessage: { id, threadId, role: 'USER' | 'COMPANION', content, createdAt }
```

---

## 4. Out of Scope

- Streaming responses (adds complexity; `max_tokens` cap mitigates latency)
- Node number shown on the memory map screen (the numbers come from the companion context; a follow-up feature)
- Search/retrieval augmentation for very large knowledge maps (not needed at current scale)

---

## 5. File Manifest

| File | Change |
|---|---|
| `prisma/schema.prisma` | Add `CompanionThread`, `CompanionMessage` models |
| `src/server/cognition/llm.ts` | Add `max_tokens` to all calls; add `generateCompanionResponse` |
| `src/server/services/cognition.ts` | Lift `polishInsights` out of transaction; parallelize `ensureUserPreference` + `classifyTopics` |
| `src/server/services/companion.ts` | New — `getOrCreateCompanionThread`, `addCompanionReply`, `buildCompanionContext` |
| `src/server/contracts.ts` | Add `companionReplySchema` |
| `src/app/api/companion/route.ts` | New — GET handler |
| `src/app/api/companion/reply/route.ts` | New — POST handler |
| `mobile/types/api.ts` | Add `CompanionThread`, `CompanionMessage` types |
| `mobile/lib/api.ts` | Add `companion` namespace |
| `mobile/app/companion/index.tsx` | New — companion screen |
