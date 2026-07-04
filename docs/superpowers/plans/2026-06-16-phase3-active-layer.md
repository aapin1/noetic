# Phase 3 — Active Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Phase 3: the Position System (users state intellectual positions that new captures are tested against) and Socratic Companion (per-topic AI dialogue threads that argue with the user's thinking).

**Architecture:** Two independent subsystems sharing four new Prisma models. Position System: `UserPosition` + `PositionChallenge` + one new LLM function; the captures POST route is augmented to detect challenges post-capture. Socratic Companion: `SocraticThread` + `SocraticMessage` + two new LLM functions; a dedicated route pair manages thread state. Mobile surfaces both in Mind tab and dedicated stack screens.

**Tech Stack:** Next.js 14 (`handleRoute`/`requireRequestUserId`), Prisma/PostgreSQL, OpenAI gpt-4o-mini (raw `fetch`, JSON mode), Expo 51 React Native, TypeScript, vitest

---

## File Map

**New backend files:**
- `src/server/services/positions.ts` — createPosition, getPositionsForUser, getPositionByTopic, checkCaptureAgainstPositions, acknowledgeChallenge
- `src/server/services/socratic.ts` — getOrCreateThread, addUserReply
- `src/server/phase3.test.ts` — all Phase 3 unit tests (LLM functions)
- `src/app/api/positions/route.ts` — GET list, POST create
- `src/app/api/positions/[topicId]/route.ts` — GET position by topic
- `src/app/api/positions/challenges/[challengeId]/route.ts` — PATCH acknowledge
- `src/app/api/socratic/[topicId]/route.ts` — GET or create thread
- `src/app/api/socratic/[topicId]/reply/route.ts` — POST reply

**Modified backend files:**
- `prisma/schema.prisma` — 4 new models, 2 new enums, 3 relation additions
- `src/server/cognition/llm.ts` — evaluatePositionTension, generateSocraticOpening, generateSocraticResponse
- `src/server/contracts.ts` — createPositionSchema, acknowledgeSchema
- `src/app/api/captures/route.ts` — position check after captureItem

**New mobile files:**
- `mobile/app/position/create.tsx` — position creation form
- `mobile/app/position/[topicId].tsx` — position detail + challenge list
- `mobile/app/socratic/[topicId].tsx` — socratic companion thread UI

**Modified mobile files:**
- `mobile/types/api.ts` — UserPosition, PositionChallengeItem, SocraticThread, SocraticMessage, updated CaptureResponse
- `mobile/lib/api.ts` — api.positions.* and api.socratic.*
- `mobile/app/(tabs)/mind.tsx` — positions section, "Take a position" CTA, "Open dialogue" button

---

## Part A — Position System

---

### Task 1: Schema — add 4 models, 2 enums, 3 relation fields

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add two new enums**

After the `CognitiveEventType` enum (around line 98), insert:

```prisma
enum PositionStatus {
  ACTIVE
  REVISED
  ABANDONED
}

enum SocraticRole {
  USER
  COMPANION
}
```

- [ ] **Step 2: Add relation fields to existing models**

In the `User` model, after the `preference UserPreference?` line, add:
```prisma
  positions        UserPosition[]
  socraticThreads  SocraticThread[]
```

In the `Topic` model, after the `capturedTags CapturedItemTopic[]` line, add:
```prisma
  positions        UserPosition[]
  socraticThreads  SocraticThread[]
```

In the `CapturedItem` model, after the `cognitiveEvents CognitiveEvent[]` line, add:
```prisma
  positionChallenges PositionChallenge[]
```

- [ ] **Step 3: Add 4 new models at the end of the file**

Append after the `UserPreference` model:

```prisma
model UserPosition {
  id                     String              @id @default(cuid())
  userId                 String
  topicId                String
  statement              String              @db.Text
  captureCountAtCreation Int                 @default(0)
  status                 PositionStatus      @default(ACTIVE)
  createdAt              DateTime            @default(now())
  updatedAt              DateTime            @updatedAt
  user                   User                @relation(fields: [userId], references: [id], onDelete: Cascade)
  topic                  Topic               @relation(fields: [topicId], references: [id], onDelete: Cascade)
  challenges             PositionChallenge[]

  @@unique([userId, topicId])
  @@index([userId, createdAt])
}

model PositionChallenge {
  id             String       @id @default(cuid())
  positionId     String
  capturedItemId String
  tension        String       @db.Text
  acknowledged   Boolean      @default(false)
  revised        Boolean      @default(false)
  revision       String?      @db.Text
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt
  position       UserPosition @relation(fields: [positionId], references: [id], onDelete: Cascade)
  capturedItem   CapturedItem @relation(fields: [capturedItemId], references: [id], onDelete: Cascade)

  @@unique([positionId, capturedItemId])
  @@index([positionId, createdAt])
}

model SocraticThread {
  id        String            @id @default(cuid())
  userId    String
  topicId   String
  createdAt DateTime          @default(now())
  updatedAt DateTime          @updatedAt
  user      User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  topic     Topic             @relation(fields: [topicId], references: [id], onDelete: Cascade)
  messages  SocraticMessage[]

  @@unique([userId, topicId])
  @@index([userId, updatedAt])
}

model SocraticMessage {
  id        String         @id @default(cuid())
  threadId  String
  role      SocraticRole
  content   String         @db.Text
  createdAt DateTime       @default(now())
  thread    SocraticThread @relation(fields: [threadId], references: [id], onDelete: Cascade)

  @@index([threadId, createdAt])
}
```

- [ ] **Step 4: Push schema and regenerate client**

```bash
npm run db:push && npm run prisma:generate
```

Expected: No errors. Prisma logs 4 new tables created.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat: add UserPosition, PositionChallenge, SocraticThread, SocraticMessage schema"
```

---

### Task 2: LLM — `evaluatePositionTension` (TDD)

**Files:**
- Create: `src/server/phase3.test.ts`
- Modify: `src/server/cognition/llm.ts`

- [ ] **Step 1: Write the failing test**

Create `src/server/phase3.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluatePositionTension } from "@/server/cognition/llm";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("evaluatePositionTension", () => {
  it("returns null when OPENAI_API_KEY is not set", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const result = await evaluatePositionTension({
      topicName: "free will",
      positionStatement: "Free will is real.",
      captureTitle: "Hard Determinism",
      captureText: "Every event is causally necessitated by prior events.",
    });
    expect(result).toBeNull();
  });

  it("returns null when has_tension is false", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ tension: null, has_tension: false }) } }],
      }),
    }));
    const result = await evaluatePositionTension({
      topicName: "free will",
      positionStatement: "Free will is real.",
      captureTitle: "Libertarian Agency",
      captureText: "Agent causation grounds genuine freedom.",
    });
    expect(result).toBeNull();
  });

  it("returns the tension string when has_tension is true", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const tension = "The capture's causal closure argument directly undermines the position's agent-causal premise.";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ tension, has_tension: true }) } }],
      }),
    }));
    const result = await evaluatePositionTension({
      topicName: "free will",
      positionStatement: "Free will is real.",
      captureTitle: "Hard Determinism",
      captureText: "Every event is causally necessitated.",
    });
    expect(result).toBe(tension);
  });

  it("returns null when fetch is not ok", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    const result = await evaluatePositionTension({
      topicName: "free will",
      positionStatement: "Free will is real.",
      captureTitle: "Any",
      captureText: "Any.",
    });
    expect(result).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));
    const result = await evaluatePositionTension({
      topicName: "free will",
      positionStatement: "Free will is real.",
      captureTitle: "Any",
      captureText: "Any.",
    });
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

```bash
npm run test:unit -- --reporter=verbose src/server/phase3.test.ts
```

Expected: FAIL — `evaluatePositionTension` is not exported from llm.ts yet.

- [ ] **Step 3: Implement `evaluatePositionTension` in `src/server/cognition/llm.ts`**

Append at the end of `src/server/cognition/llm.ts`:

```typescript
export async function evaluatePositionTension(args: {
  topicName: string;
  positionStatement: string;
  captureTitle: string;
  captureText: string;
}): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const systemPrompt = [
    `A user has stated a position on "${args.topicName}". They just captured something new on the same topic.`,
    "Determine if the new capture genuinely challenges, complicates, or undermines the stated position.",
    "If yes: name the specific tension in 1-2 sentences — what exactly in the capture conflicts with what exactly in the position.",
    "If the capture reinforces or is neutral to the position, return has_tension: false.",
    "",
    "Rules:",
    "- Only flag genuine intellectual tension, not superficial disagreement.",
    "- Name the exact claim in the capture that conflicts with the exact aspect of the position.",
    "- Do not start the tension with 'This capture' or 'The new capture'.",
    "- Bad: 'They disagree about free will.' Good: 'The capture's causal-closure argument removes the space the position's agent-causation claim requires.'",
    "",
    "Return strictly valid JSON (no markdown): {\"tension\": \"...\" | null, \"has_tension\": true | false}",
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
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: JSON.stringify({
              position: args.positionStatement,
              capture_title: args.captureTitle,
              capture_text: args.captureText.slice(0, 800),
            }),
          },
        ],
      }),
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = payload.choices?.[0]?.message?.content;
    if (!raw) return null;

    const parsed = JSON.parse(raw) as { tension?: unknown; has_tension?: boolean };
    if (!parsed.has_tension || typeof parsed.tension !== "string" || parsed.tension.trim().length === 0) return null;

    return parsed.tension.trim();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Run test to confirm pass**

```bash
npm run test:unit -- --reporter=verbose src/server/phase3.test.ts
```

Expected: All 5 `evaluatePositionTension` tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/phase3.test.ts src/server/cognition/llm.ts
git commit -m "feat: add evaluatePositionTension LLM function with tests"
```

---

### Task 3: Positions service

**Files:**
- Create: `src/server/services/positions.ts`

- [ ] **Step 1: Create the positions service**

Create `src/server/services/positions.ts`:

```typescript
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/api";
import type { DbClient } from "@/server/db";
import { evaluatePositionTension } from "@/server/cognition/llm";

export async function createPosition(args: {
  userId: string;
  topicId: string;
  statement: string;
  captureCountAtCreation: number;
  db?: DbClient;
}) {
  const db = args.db ?? prisma;
  const existing = await db.userPosition.findUnique({
    where: { userId_topicId: { userId: args.userId, topicId: args.topicId } },
  });
  if (existing) {
    throw new AppError("POSITION_EXISTS", "A position already exists for this topic", 409);
  }
  return db.userPosition.create({
    data: {
      userId: args.userId,
      topicId: args.topicId,
      statement: args.statement.trim(),
      captureCountAtCreation: args.captureCountAtCreation,
    },
    include: {
      topic: { select: { name: true, slug: true } },
      challenges: true,
    },
  });
}

export async function getPositionsForUser(args: { userId: string; db?: DbClient }) {
  const db = args.db ?? prisma;
  return db.userPosition.findMany({
    where: { userId: args.userId },
    orderBy: { createdAt: "desc" },
    include: {
      topic: { select: { name: true, slug: true } },
      challenges: {
        orderBy: { createdAt: "desc" },
        include: {
          capturedItem: {
            select: {
              id: true,
              rawText: true,
              contentItem: { select: { title: true } },
            },
          },
        },
      },
    },
  });
}

export async function getPositionByTopic(args: {
  userId: string;
  topicId: string;
  db?: DbClient;
}) {
  const db = args.db ?? prisma;
  return db.userPosition.findUnique({
    where: { userId_topicId: { userId: args.userId, topicId: args.topicId } },
    include: {
      topic: { select: { name: true, slug: true } },
      challenges: {
        orderBy: { createdAt: "desc" },
        include: {
          capturedItem: {
            select: {
              id: true,
              rawText: true,
              contentItem: { select: { title: true } },
            },
          },
        },
      },
    },
  });
}

export async function checkCaptureAgainstPositions(args: {
  userId: string;
  capturedItemId: string;
  topicIds: string[];
  captureTitle: string;
  captureText: string;
  db?: DbClient;
}): Promise<{ challengeId: string; positionId: string; topicName: string; tension: string } | null> {
  if (args.topicIds.length === 0) return null;
  const db = args.db ?? prisma;

  const positions = await db.userPosition.findMany({
    where: { userId: args.userId, topicId: { in: args.topicIds }, status: "ACTIVE" },
    include: { topic: { select: { name: true } } },
    take: 1,
  });

  if (positions.length === 0) return null;

  const position = positions[0];
  const tension = await evaluatePositionTension({
    topicName: position.topic.name,
    positionStatement: position.statement,
    captureTitle: args.captureTitle,
    captureText: args.captureText,
  });

  if (!tension) return null;

  const challenge = await db.positionChallenge.create({
    data: {
      positionId: position.id,
      capturedItemId: args.capturedItemId,
      tension,
    },
  });

  return {
    challengeId: challenge.id,
    positionId: position.id,
    topicName: position.topic.name,
    tension,
  };
}

export async function acknowledgeChallenge(args: {
  userId: string;
  challengeId: string;
  revision?: string;
  db?: DbClient;
}) {
  const db = args.db ?? prisma;

  const challenge = await db.positionChallenge.findUnique({
    where: { id: args.challengeId },
    include: { position: { select: { userId: true, id: true } } },
  });

  if (!challenge || challenge.position.userId !== args.userId) {
    throw new AppError("CHALLENGE_NOT_FOUND", "Challenge not found", 404);
  }

  if (challenge.acknowledged) {
    throw new AppError("ALREADY_ACKNOWLEDGED", "Challenge already acknowledged", 409);
  }

  await prisma.$transaction(async (tx) => {
    await tx.positionChallenge.update({
      where: { id: args.challengeId },
      data: {
        acknowledged: true,
        revised: !!args.revision,
        revision: args.revision?.trim() ?? null,
      },
    });

    if (args.revision) {
      await tx.userPosition.update({
        where: { id: challenge.position.id },
        data: { statement: args.revision.trim(), status: "REVISED" },
      });
    }
  });
}
```

- [ ] **Step 2: Run unit tests to confirm existing suite still passes**

```bash
npm run test:unit
```

Expected: All tests pass (no regressions).

- [ ] **Step 3: Commit**

```bash
git add src/server/services/positions.ts
git commit -m "feat: add positions service (createPosition, checkCaptureAgainstPositions, acknowledgeChallenge)"
```

---

### Task 4: Positions Zod schemas + API routes

**Files:**
- Modify: `src/server/contracts.ts`
- Create: `src/app/api/positions/route.ts`
- Create: `src/app/api/positions/[topicId]/route.ts`
- Create: `src/app/api/positions/challenges/[challengeId]/route.ts`

- [ ] **Step 1: Add Zod schemas to `src/server/contracts.ts`**

Append at the end of `src/server/contracts.ts`:

```typescript
export const createPositionSchema = z.object({
  topicId: z.string().min(1),
  statement: z.string().min(10).max(2000),
  captureCountAtCreation: z.number().int().min(0).default(0),
});

export const acknowledgeSchema = z.object({
  revision: z.string().min(10).max(2000).optional(),
});
```

- [ ] **Step 2: Create `src/app/api/positions/route.ts`**

```typescript
import { handleRoute, parseJson } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { createPositionSchema } from "@/server/contracts";
import { createPosition, getPositionsForUser } from "@/server/services/positions";

export async function GET(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    return getPositionsForUser({ userId });
  });
}

export async function POST(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    const input = await parseJson(request, createPositionSchema);
    return createPosition({
      userId,
      topicId: input.topicId,
      statement: input.statement,
      captureCountAtCreation: input.captureCountAtCreation,
    });
  }, 201);
}
```

- [ ] **Step 3: Create `src/app/api/positions/[topicId]/route.ts`**

```typescript
import { AppError, handleRoute } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { getPositionByTopic } from "@/server/services/positions";

export async function GET(
  request: Request,
  { params }: { params: { topicId: string } },
) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    const position = await getPositionByTopic({ userId, topicId: params.topicId });
    if (!position) {
      throw new AppError("POSITION_NOT_FOUND", "No position found for this topic", 404);
    }
    return position;
  });
}
```

- [ ] **Step 4: Create `src/app/api/positions/challenges/[challengeId]/route.ts`**

```typescript
import { handleRoute, parseJson } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { acknowledgeSchema } from "@/server/contracts";
import { acknowledgeChallenge } from "@/server/services/positions";

export async function PATCH(
  request: Request,
  { params }: { params: { challengeId: string } },
) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    const input = await parseJson(request, acknowledgeSchema);
    await acknowledgeChallenge({
      userId,
      challengeId: params.challengeId,
      revision: input.revision,
    });
    return { acknowledged: true };
  });
}
```

- [ ] **Step 5: Run unit tests**

```bash
npm run test:unit
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/server/contracts.ts src/app/api/positions/route.ts src/app/api/positions/[topicId]/route.ts "src/app/api/positions/challenges/[challengeId]/route.ts"
git commit -m "feat: add positions API routes (list, create, get-by-topic, acknowledge)"
```

---

### Task 5: Wire position check into captures route

**Files:**
- Modify: `src/app/api/captures/route.ts`

- [ ] **Step 1: Update `src/app/api/captures/route.ts`**

Replace the entire file with:

```typescript
import { CaptureKind } from "@prisma/client";
import { handleRoute, parseJson, parseSearchParams } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { captureListSchema, captureSchema } from "@/server/contracts";
import { captureItem, listCaptures } from "@/server/services/cognition";
import { checkCaptureAgainstPositions } from "@/server/services/positions";

export async function POST(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    const input = await parseJson(request, captureSchema);
    const capture = await captureItem({
      userId,
      kind: input.kind as CaptureKind,
      url: input.url,
      text: input.text,
      caption: input.caption,
      mediaUrl: input.mediaUrl,
      reaction: input.reaction,
      topicHints: input.topicHints,
    });
    const positionChallenge = await checkCaptureAgainstPositions({
      userId,
      capturedItemId: capture.id,
      topicIds: capture.topics.map((t) => t.topicId),
      captureTitle: capture.title,
      captureText: capture.rawText ?? capture.summary ?? "",
    });
    return { ...capture, positionChallenge };
  }, 201);
}

export async function GET(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    const input = await parseSearchParams(request, captureListSchema);
    return listCaptures({ userId, limit: input.limit });
  });
}
```

- [ ] **Step 2: Run unit tests**

```bash
npm run test:unit
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/captures/route.ts
git commit -m "feat: check capture against positions after captureItem, include challenge in response"
```

---

### Task 6: Mobile — positions types and API client

**Files:**
- Modify: `mobile/types/api.ts`
- Modify: `mobile/lib/api.ts`

- [ ] **Step 1: Add types to `mobile/types/api.ts`**

After the `DormantThread` interface (around line 233), insert:

```typescript
// Matches the Prisma include shape returned by the positions API.
// capturedItem is the nested Prisma relation; derive display title from it.
export interface PositionChallengeItem {
  id: string;
  positionId: string;
  capturedItemId: string;
  capturedItem: {
    id: string;
    rawText: string | null;
    contentItem: { title: string } | null;
  } | null;
  tension: string;
  acknowledged: boolean;
  revised: boolean;
  revision: string | null;
  createdAt: string;
  updatedAt: string;
}

// topic is nested (Prisma include). Use position.topic.name, not position.topicName.
export interface UserPosition {
  id: string;
  userId: string;
  topicId: string;
  topic: { name: string; slug: string };
  statement: string;
  captureCountAtCreation: number;
  status: 'ACTIVE' | 'REVISED' | 'ABANDONED';
  challenges: PositionChallengeItem[];
  createdAt: string;
  updatedAt: string;
}

export interface SocraticMessage {
  id: string;
  threadId: string;
  role: 'USER' | 'COMPANION';
  content: string;
  createdAt: string;
}

// topic is nested (Prisma include). Use thread.topic.name, not thread.topicName.
export interface SocraticThread {
  id: string;
  userId: string;
  topicId: string;
  topic: { name: string };
  messages: SocraticMessage[];
  createdAt: string;
  updatedAt: string;
}

// Returned in CaptureResponse when a new capture challenges an existing position.
export interface CapturePositionChallenge {
  challengeId: string;
  positionId: string;
  topicName: string;
  tension: string;
}
```

- [ ] **Step 2: Update `CaptureResponse` in `mobile/types/api.ts`**

Find the `CaptureResponse` interface (around line 77) and add `positionChallenge`:

```typescript
export interface CaptureResponse extends CapturedItem {
  insights: InsightCard[];
  related: RelatedItem[];
  edges: { fromItemId: string; toItemId: string; type: MemoryEdgeType; weight: number }[];
  threadContext: { topicName: string; captureCount: number } | null;
  recommendations: Recommendation[];
  positionChallenge: CapturePositionChallenge | null;
}
```

- [ ] **Step 3: Add positions and socratic namespaces to `mobile/lib/api.ts`**

After the closing `},` of the `memory` namespace (line ~194), insert:

```typescript
  positions: {
    list() {
      return request<UserPosition[]>('/api/positions');
    },
    create(body: { topicId: string; statement: string; captureCountAtCreation: number }) {
      return request<UserPosition>('/api/positions', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    getByTopic(topicId: string) {
      return request<UserPosition>(`/api/positions/${topicId}`);
    },
    acknowledge(challengeId: string, revision?: string) {
      return request<{ acknowledged: boolean }>(
        `/api/positions/challenges/${challengeId}`,
        { method: 'PATCH', body: JSON.stringify({ revision }) },
      );
    },
  },

  socratic: {
    getThread(topicId: string) {
      return request<SocraticThread>(`/api/socratic/${topicId}`);
    },
    reply(topicId: string, content: string) {
      return request<{ userMessage: SocraticMessage; companionMessage: SocraticMessage }>(
        `/api/socratic/${topicId}/reply`,
        { method: 'POST', body: JSON.stringify({ content }) },
      );
    },
  },
```

- [ ] **Step 4: Add missing imports to `mobile/lib/api.ts`**

In the import from `'@/types/api'`, add `UserPosition`, `SocraticThread`, `SocraticMessage`, `CapturePositionChallenge` to the type imports list.

- [ ] **Step 5: Confirm TypeScript compiles**

```bash
cd mobile && npx tsc --noEmit 2>&1 | head -40
```

Expected: No errors (or only pre-existing errors unrelated to these changes).

- [ ] **Step 6: Commit**

```bash
git add mobile/types/api.ts mobile/lib/api.ts
git commit -m "feat: add UserPosition, SocraticThread types and api.positions/socratic client methods"
```

---

### Task 7: Mobile — position creation screen

**Files:**
- Create: `mobile/app/position/create.tsx`

- [ ] **Step 1: Create `mobile/app/position/create.tsx`**

```typescript
import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@/lib/api';
import { Radius, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';

export default function PositionCreateScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const { topicId, topicName, captureCount } = useLocalSearchParams<{
    topicId: string;
    topicName: string;
    captureCount: string;
  }>();

  const [statement, setStatement] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = statement.trim().length >= 10 && !saving;

  async function handleSubmit() {
    if (!canSubmit || !topicId) return;
    setSaving(true);
    setError(null);
    try {
      await api.positions.create({
        topicId,
        statement,
        captureCountAtCreation: parseInt(captureCount ?? '0', 10),
      });
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={[styles.header, { borderBottomColor: c.border }]}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Text variant="body" color="muted">Cancel</Text>
          </Pressable>
          <Text variant="wordmark" style={{ fontSize: 16 }}>Take a position</Text>
          <Pressable
            onPress={handleSubmit}
            disabled={!canSubmit}
            style={styles.doneBtn}
          >
            <Text variant="bodyMedium" color={canSubmit ? 'primary' : 'muted'}>
              {saving ? 'Saving…' : 'Done'}
            </Text>
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <Text variant="monoSmall" color="muted" style={styles.topicLabel}>
            {topicName ?? 'Topic'}
          </Text>
          <Text variant="body" color="secondary" style={styles.prompt}>
            After exploring this thread, where has your thinking landed?
          </Text>
          <TextInput
            style={[styles.input, { color: c.text, borderColor: c.border }]}
            placeholder="State your position…"
            placeholderTextColor={c.faint}
            value={statement}
            onChangeText={setStatement}
            multiline
            autoFocus
            textAlignVertical="top"
          />
          <Text variant="monoSmall" color="muted" style={styles.hint}>
            This becomes a thesis node on your map. New captures on this topic will be tested against it.
          </Text>
          {error && (
            <Text variant="monoSmall" style={[styles.errorText, { color: c.destructive }]}>
              {error}
            </Text>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { minWidth: 60 },
  doneBtn: { minWidth: 60, alignItems: 'flex-end' },
  content: { padding: Spacing[4], gap: Spacing[4] },
  topicLabel: { textTransform: 'uppercase', letterSpacing: 1 },
  prompt: { lineHeight: 24 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    padding: Spacing[3],
    minHeight: 120,
    fontSize: 16,
    lineHeight: 24,
  },
  hint: { lineHeight: 18 },
  errorText: { marginTop: Spacing[2] },
});
```

- [ ] **Step 2: Commit**

```bash
git add mobile/app/position/create.tsx
git commit -m "feat: add position creation screen"
```

---

### Task 8: Mobile — position detail screen

**Files:**
- Create: `mobile/app/position/[topicId].tsx`

- [ ] **Step 1: Create `mobile/app/position/[topicId].tsx`**

```typescript
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { Radius, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import type { PositionChallengeItem } from '@/types/api';

function ChallengeCard({
  challenge,
  onAcknowledge,
}: {
  challenge: PositionChallengeItem;
  onAcknowledge: (challengeId: string, revision?: string) => void;
}) {
  const c = useThemeColors();
  const [revising, setRevising] = useState(false);
  const [revisionText, setRevisionText] = useState('');

  const captureTitle =
    challenge.capturedItem?.contentItem?.title ??
    challenge.capturedItem?.rawText?.slice(0, 80) ??
    'Untitled capture';

  if (challenge.acknowledged) {
    return (
      <View style={[styles.challengeCard, { borderColor: c.borderSubtle, opacity: 0.5 }]}>
        <Text variant="monoSmall" color="muted">{captureTitle}</Text>
        <Text variant="monoSmall" color="muted" style={{ marginTop: Spacing[2] }}>
          {challenge.revised ? 'Position revised' : 'Noted'}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.challengeCard, { borderColor: c.border }]}>
      <Text variant="monoSmall" color="muted" style={styles.challengeSource}>
        {captureTitle}
      </Text>
      <Text variant="body" color="secondary" style={styles.tensionText}>
        {challenge.tension}
      </Text>
      {revising ? (
        <View style={styles.revisionBlock}>
          <TextInput
            style={[styles.revisionInput, { color: c.text, borderColor: c.borderSubtle }]}
            placeholder="Revise your position…"
            placeholderTextColor={c.faint}
            value={revisionText}
            onChangeText={setRevisionText}
            multiline
            textAlignVertical="top"
            autoFocus
          />
          <View style={styles.revisionActions}>
            <Pressable onPress={() => setRevising(false)}>
              <Text variant="monoSmall" color="muted">Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() => onAcknowledge(challenge.id, revisionText)}
              disabled={revisionText.trim().length < 10}
            >
              <Text variant="monoSmall" color={revisionText.trim().length >= 10 ? 'primary' : 'muted'}>
                Save revision
              </Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.challengeActions}>
          <Pressable
            style={[styles.actionBtn, { borderColor: c.borderSubtle }]}
            onPress={() => onAcknowledge(challenge.id)}
          >
            <Text variant="monoSmall">Sit with it</Text>
          </Pressable>
          <Pressable
            style={[styles.actionBtn, { borderColor: c.borderSubtle }]}
            onPress={() => setRevising(true)}
          >
            <Text variant="monoSmall">Revise position</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

export default function PositionDetailScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const { topicId } = useLocalSearchParams<{ topicId: string }>();
  const { data: position, loading, error, refetch } = useApiQuery(
    () => api.positions.getByTopic(topicId!),
    [topicId],
  );

  async function handleAcknowledge(challengeId: string, revision?: string) {
    try {
      await api.positions.acknowledge(challengeId, revision);
      void refetch();
    } catch {
      // refetch so UI reflects server state
      void refetch();
    }
  }

  if (loading && !position) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
        <ActivityIndicator style={{ marginTop: Spacing[8] }} />
      </SafeAreaView>
    );
  }

  if (error || !position) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
        <View style={[styles.header, { borderBottomColor: c.border }]}>
          <Pressable onPress={() => router.back()}><Text variant="body" color="muted">Back</Text></Pressable>
        </View>
        <Text variant="body" color="muted" style={{ padding: Spacing[4] }}>Position not found.</Text>
      </SafeAreaView>
    );
  }

  const pending = position.challenges.filter((ch) => !ch.acknowledged);
  const acknowledged = position.challenges.filter((ch) => ch.acknowledged);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <Pressable onPress={() => router.back()}>
          <Text variant="body" color="muted">Back</Text>
        </Pressable>
        <Text variant="monoSmall" color="muted">{position.topicName}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.statementCard, { borderColor: c.border }]}>
          <Text variant="monoSmall" color="muted" style={styles.sectionLabel}>My position</Text>
          <Text variant="body" style={styles.statementText}>{position.statement}</Text>
          {position.status === 'REVISED' && (
            <Text variant="monoSmall" color="muted" style={{ marginTop: Spacing[2] }}>Revised</Text>
          )}
        </View>

        <Pressable
          style={[styles.dialogueBtn, { borderColor: c.border }]}
          onPress={() => router.push({ pathname: '/socratic/[topicId]', params: { topicId: topicId! } })}
        >
          <Text variant="bodyMedium">Open Socratic dialogue →</Text>
        </Pressable>

        {pending.length > 0 && (
          <View>
            <Text variant="monoSmall" color="muted" style={styles.sectionLabel}>
              Challenges ({pending.length})
            </Text>
            {pending.map((ch) => (
              <ChallengeCard key={ch.id} challenge={ch} onAcknowledge={handleAcknowledge} />
            ))}
          </View>
        )}

        {acknowledged.length > 0 && (
          <View>
            <Text variant="monoSmall" color="muted" style={styles.sectionLabel}>
              Acknowledged ({acknowledged.length})
            </Text>
            {acknowledged.map((ch) => (
              <ChallengeCard key={ch.id} challenge={ch} onAcknowledge={handleAcknowledge} />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  content: { padding: Spacing[4], gap: Spacing[4] },
  sectionLabel: { textTransform: 'uppercase', letterSpacing: 1, marginBottom: Spacing[2] },
  statementCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    padding: Spacing[4],
  },
  statementText: { marginTop: Spacing[2], lineHeight: 24 },
  dialogueBtn: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    padding: Spacing[4],
    alignItems: 'center',
  },
  challengeCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    padding: Spacing[4],
    marginBottom: Spacing[3],
  },
  challengeSource: { textTransform: 'uppercase', letterSpacing: 0.5 },
  tensionText: { marginTop: Spacing[2], lineHeight: 22 },
  challengeActions: {
    flexDirection: 'row',
    gap: Spacing[3],
    marginTop: Spacing[4],
  },
  actionBtn: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sm,
    paddingVertical: Spacing[2],
    alignItems: 'center',
  },
  revisionBlock: { marginTop: Spacing[3], gap: Spacing[3] },
  revisionInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sm,
    padding: Spacing[3],
    minHeight: 80,
    fontSize: 14,
    lineHeight: 20,
  },
  revisionActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add "mobile/app/position/[topicId].tsx"
git commit -m "feat: add position detail screen with challenge acknowledgment"
```

---

### Task 9: Mind tab — positions section and "Take a position" CTA

**Files:**
- Modify: `mobile/app/(tabs)/mind.tsx`

- [ ] **Step 1: Read the current bottom of `MindScreen` function in `mobile/app/(tabs)/mind.tsx`**

Read from line 163 to the end of the file to understand the current render structure and styles object before editing.

- [ ] **Step 2: Add imports**

At the top of `mobile/app/(tabs)/mind.tsx`, add these to the existing import list:
- Add `useFocusEffect` (already imported) — no change needed
- Add to existing React Native imports: no additions needed
- Add to `@/types/api` imports: `UserPosition`
- Add a new import line for the positions API

In the import from `'@/types/api'`, add `UserPosition` to the destructure list.

- [ ] **Step 3: Add `PositionCard` component before `MindScreen`**

Insert this component before `export default function MindScreen()`:

```typescript
function PositionCard({
  position,
  onNavigate,
  onTakePosition,
}: {
  position?: UserPosition;
  onNavigate: () => void;
  onTakePosition?: () => void;
}) {
  const c = useThemeColors();
  const pending = position?.challenges.filter((ch) => !ch.acknowledged).length ?? 0;

  if (!position) {
    return (
      <Pressable
        style={[styles.card, styles.positionCta, { borderColor: c.border }]}
        onPress={onTakePosition}
      >
        <Text variant="bodyMedium">Take a position →</Text>
      </Pressable>
    );
  }

  return (
    <Pressable
      style={[styles.card, { borderColor: c.border }]}
      onPress={onNavigate}
    >
      <View style={styles.synthesisMeta}>
        <Text variant="monoSmall" color="muted">{position.topic.name}</Text>
        {pending > 0 && (
          <Text variant="monoSmall" color="muted">{pending} challenge{pending !== 1 ? 's' : ''}</Text>
        )}
      </View>
      <Text variant="body" numberOfLines={3} style={{ marginTop: Spacing[3], paddingHorizontal: Spacing[4] }}>
        {position.statement}
      </Text>
      <View style={[styles.tensionRow, { borderTopColor: c.borderSubtle }]}>
        <Text variant="monoSmall" color="muted">
          {position.status === 'REVISED' ? 'Revised · ' : ''}{position.captureCountAtCreation} captures at creation
        </Text>
      </View>
    </Pressable>
  );
}
```

- [ ] **Step 4: Update `ThreadSynthesisView` to include a "Take a position" or "View position" button**

Replace the `ThreadSynthesisView` function (lines ~78-97) with:

```typescript
function ThreadSynthesisView({
  synthesis,
  position,
}: {
  synthesis: ThreadSynthesis;
  position?: UserPosition;
}) {
  const c = useThemeColors();
  const router = useRouter();
  return (
    <View style={[styles.card, { borderColor: c.border }]}>
      <View style={styles.synthesisMeta}>
        <Text variant="monoSmall" color="muted">{synthesis.topicName}</Text>
        <Text variant="monoSmall" color="muted">{synthesis.captureCount} captures</Text>
      </View>
      <Text variant="bodyMedium" style={{ marginTop: Spacing[3], paddingHorizontal: Spacing[4] }}>
        {synthesis.position}
      </Text>
      <View style={[styles.openQuestionRow, { borderTopColor: c.borderSubtle }]}>
        <Text variant="monoSmall" color="muted" style={styles.openQuestionLabel}>open question</Text>
        <Text variant="monoSmall" color="secondary" style={{ marginTop: Spacing[2] }}>
          {synthesis.openQuestion}
        </Text>
      </View>
      <Pressable
        style={[styles.positionCta, { borderTopColor: c.borderSubtle }]}
        onPress={() => {
          if (position) {
            router.push({ pathname: '/position/[topicId]', params: { topicId: synthesis.topicId } });
          } else {
            router.push({
              pathname: '/position/create',
              params: {
                topicId: synthesis.topicId,
                topicName: synthesis.topicName,
                captureCount: String(synthesis.captureCount),
              },
            });
          }
        }}
      >
        <Text variant="monoSmall" color="muted">
          {position ? 'View position →' : 'Take a position →'}
        </Text>
      </Pressable>
    </View>
  );
}
```

- [ ] **Step 5: Update `MindScreen` to load positions and pass them to components**

In `MindScreen`, add a second `useApiQuery` call below the existing one:

```typescript
const { data: positions } = useApiQuery(
  () => api.positions.list(),
  [],
);
```

Build a position map above the return:

```typescript
const positionByTopic = new Map((positions ?? []).map((p) => [p.topicId, p]));
```

In the `ThreadSynthesisView` render, update the call to pass `position`:

```typescript
{data.threadSyntheses.map((synthesis) => (
  <ThreadSynthesisView
    key={synthesis.topicId}
    synthesis={synthesis}
    position={positionByTopic.get(synthesis.topicId)}
  />
))}
```

- [ ] **Step 6: Add `positionCta` to the StyleSheet in `mind.tsx`**

In the existing `StyleSheet.create({...})` at the bottom, add:

```typescript
  positionCta: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[3],
  },
```

- [ ] **Step 7: Commit**

```bash
git add "mobile/app/(tabs)/mind.tsx"
git commit -m "feat: add positions section and Take a position CTA to Mind tab"
```

---

## Part B — Socratic Companion

---

### Task 10: LLM — `generateSocraticOpening` and `generateSocraticResponse` (TDD)

**Files:**
- Modify: `src/server/phase3.test.ts`
- Modify: `src/server/cognition/llm.ts`

- [ ] **Step 1: Add tests to `src/server/phase3.test.ts`**

Append after the existing `evaluatePositionTension` describe block:

```typescript
// ── generateSocraticOpening ───────────────────────────────────────────────────

describe("generateSocraticOpening", () => {
  const captures = [
    { label: "Capture A", keyIdea: "hard problem", text: "Consciousness is irreducible." },
    { label: "Capture B", keyIdea: "qualia", text: "Phenomenal states cannot be functionally defined." },
  ];

  it("returns null when OPENAI_API_KEY is not set", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const result = await generateSocraticOpening({
      topicName: "consciousness",
      positionStatement: null,
      captures,
    });
    expect(result).toBeNull();
  });

  it("returns the challenge string from a valid API response", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ challenge: "What grounds the irreducibility claim?" }) } }],
      }),
    }));
    const result = await generateSocraticOpening({
      topicName: "consciousness",
      positionStatement: "Consciousness is not reducible to physical processes.",
      captures,
    });
    expect(result).toBe("What grounds the irreducibility claim?");
  });

  it("returns null when fetch is not ok", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    const result = await generateSocraticOpening({ topicName: "consciousness", positionStatement: null, captures });
    expect(result).toBeNull();
  });

  it("returns null when challenge field is empty", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ challenge: "" }) } }],
      }),
    }));
    const result = await generateSocraticOpening({ topicName: "consciousness", positionStatement: null, captures });
    expect(result).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
    const result = await generateSocraticOpening({ topicName: "consciousness", positionStatement: null, captures });
    expect(result).toBeNull();
  });
});

// ── generateSocraticResponse ─────────────────────────────────────────────────

describe("generateSocraticResponse", () => {
  const history = [
    { role: "COMPANION" as const, content: "What grounds your claim?" },
    { role: "USER" as const, content: "I think qualia are irreducible because..." },
  ];

  it("returns null when OPENAI_API_KEY is not set", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const result = await generateSocraticResponse({
      topicName: "consciousness",
      positionStatement: null,
      captures: [],
      conversationHistory: history,
      userReply: "My reply.",
    });
    expect(result).toBeNull();
  });

  it("returns the follow-up challenge from a valid API response", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ challenge: "But does that argument beg the question?" }) } }],
      }),
    }));
    const result = await generateSocraticResponse({
      topicName: "consciousness",
      positionStatement: "Consciousness is irreducible.",
      captures: [{ label: "Capture A", keyIdea: "hard problem" }],
      conversationHistory: history,
      userReply: "Qualia cannot be functionally described.",
    });
    expect(result).toBe("But does that argument beg the question?");
  });

  it("returns null when fetch throws", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    const result = await generateSocraticResponse({
      topicName: "consciousness",
      positionStatement: null,
      captures: [],
      conversationHistory: history,
      userReply: "reply",
    });
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm new tests fail**

```bash
npm run test:unit -- --reporter=verbose src/server/phase3.test.ts
```

Expected: evaluatePositionTension tests PASS. generateSocraticOpening + generateSocraticResponse tests FAIL — not exported yet.

- [ ] **Step 3: Implement both functions in `src/server/cognition/llm.ts`**

Append after `evaluatePositionTension`:

```typescript
export async function generateSocraticOpening(args: {
  topicName: string;
  positionStatement: string | null;
  captures: { label: string; keyIdea: string | null; text: string }[];
}): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const positionNote = args.positionStatement
    ? `The user has stated a position: "${args.positionStatement}". Open by probing the assumption this position most depends on.`
    : "The user has not yet stated a position. Open by identifying the unresolved tension in what they've captured.";

  const systemPrompt = [
    `You are the Socratic companion in Mneme, a personal memory map for a user exploring "${args.topicName}".`,
    "Your role: engage them in genuine philosophical dialogue — not to teach, not to validate, but to find the precise point where their thinking is not yet resolved.",
    "",
    positionNote,
    "",
    "Rules:",
    "- Do not summarize what they've read.",
    "- Identify one specific tension or unresolved assumption in their captures.",
    "- Ask exactly one question. Precise. Genuinely answerable with more thought.",
    "- Do not start with 'Great!', affirmations, or 'You've been exploring'.",
    "- 2–4 sentences maximum. The question is the last sentence.",
    "",
    "Return strictly valid JSON (no markdown): {\"challenge\": \"...\"}",
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
        temperature: 0.5,
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
                excerpt: c.text.slice(0, 300),
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

    const parsed = JSON.parse(raw) as { challenge?: unknown };
    if (typeof parsed.challenge !== "string" || parsed.challenge.trim().length === 0) return null;

    return parsed.challenge.trim();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function generateSocraticResponse(args: {
  topicName: string;
  positionStatement: string | null;
  captures: { label: string; keyIdea: string | null }[];
  conversationHistory: { role: "USER" | "COMPANION"; content: string }[];
  userReply: string;
}): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const positionNote = args.positionStatement
    ? `The user's stated position: "${args.positionStatement}".`
    : "The user has not yet stated a position.";

  const systemPrompt = [
    `You are the Socratic companion in a personal memory map for a user exploring "${args.topicName}".`,
    positionNote,
    "You have read all their captures on this topic. You know their thinking better than they do.",
    "",
    "The user has just replied to your last challenge. Generate the next Socratic response.",
    "",
    "Rules:",
    "- Do not repeat or paraphrase what the user said.",
    "- Identify where their reply contains an unstated assumption, a loose move, or a productive contradiction with something they've captured.",
    "- Acknowledge what's solid in their reply in one clause at most, then immediately pivot to the pressure point.",
    "- Ask exactly one follow-up question. It must be more specific than the last one — zoom in, don't zoom out.",
    "- 2–4 sentences maximum.",
    "",
    "Return strictly valid JSON (no markdown): {\"challenge\": \"...\"}",
  ].join("\n");

  const messages = [
    { role: "system" as const, content: systemPrompt },
    ...args.conversationHistory.map((m) => ({
      role: m.role === "USER" ? ("user" as const) : ("assistant" as const),
      content: m.content,
    })),
    { role: "user" as const, content: args.userReply },
  ];

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
        messages,
      }),
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = payload.choices?.[0]?.message?.content;
    if (!raw) return null;

    const parsed = JSON.parse(raw) as { challenge?: unknown };
    if (typeof parsed.challenge !== "string" || parsed.challenge.trim().length === 0) return null;

    return parsed.challenge.trim();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Run all phase3 tests**

```bash
npm run test:unit -- --reporter=verbose src/server/phase3.test.ts
```

Expected: All tests PASS (15 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/phase3.test.ts src/server/cognition/llm.ts
git commit -m "feat: add generateSocraticOpening and generateSocraticResponse LLM functions with tests"
```

---

### Task 11: Socratic service

**Files:**
- Create: `src/server/services/socratic.ts`

- [ ] **Step 1: Create `src/server/services/socratic.ts`**

```typescript
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/api";
import type { DbClient } from "@/server/db";
import {
  generateSocraticOpening,
  generateSocraticResponse,
} from "@/server/cognition/llm";

const CAPTURE_CONTEXT_LIMIT = 8;
const DEFAULT_OPENING = (topicName: string) =>
  `You've been circling ${topicName} from several angles. What is the question underneath all of it that you haven't yet asked yourself?`;

export async function getOrCreateThread(args: {
  userId: string;
  topicId: string;
  db?: DbClient;
}) {
  const db = args.db ?? prisma;

  const existing = await db.socraticThread.findUnique({
    where: { userId_topicId: { userId: args.userId, topicId: args.topicId } },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      topic: { select: { name: true } },
    },
  });

  if (existing) return existing;

  const topic = await db.topic.findUnique({
    where: { id: args.topicId },
    select: { name: true },
  });
  if (!topic) throw new AppError("TOPIC_NOT_FOUND", "Topic not found", 404);

  const [topicCaptures, position] = await Promise.all([
    db.capturedItem.findMany({
      where: { userId: args.userId, topics: { some: { topicId: args.topicId } } },
      orderBy: { capturedAt: "desc" },
      take: CAPTURE_CONTEXT_LIMIT,
      select: {
        rawText: true,
        keyIdea: true,
        contentItem: { select: { title: true } },
      },
    }),
    db.userPosition.findUnique({
      where: { userId_topicId: { userId: args.userId, topicId: args.topicId } },
      select: { statement: true },
    }),
  ]);

  const opening = await generateSocraticOpening({
    topicName: topic.name,
    positionStatement: position?.statement ?? null,
    captures: topicCaptures.map((c) => ({
      label: c.contentItem?.title ?? c.rawText?.slice(0, 80) ?? "Untitled",
      keyIdea: c.keyIdea,
      text: c.rawText ?? "",
    })),
  }) ?? DEFAULT_OPENING(topic.name);

  return db.socraticThread.create({
    data: {
      userId: args.userId,
      topicId: args.topicId,
      messages: {
        create: { role: "COMPANION", content: opening },
      },
    },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      topic: { select: { name: true } },
    },
  });
}

export async function addUserReply(args: {
  userId: string;
  topicId: string;
  content: string;
  db?: DbClient;
}) {
  if (!args.content.trim()) {
    throw new AppError("EMPTY_REPLY", "Reply cannot be empty", 422);
  }

  const db = args.db ?? prisma;

  const thread = await db.socraticThread.findUnique({
    where: { userId_topicId: { userId: args.userId, topicId: args.topicId } },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      topic: { select: { name: true } },
    },
  });

  if (!thread) {
    throw new AppError("THREAD_NOT_FOUND", "Thread not found — call GET to initialise it", 404);
  }

  const [topicCaptures, position] = await Promise.all([
    db.capturedItem.findMany({
      where: { userId: args.userId, topics: { some: { topicId: args.topicId } } },
      orderBy: { capturedAt: "desc" },
      take: CAPTURE_CONTEXT_LIMIT,
      select: { keyIdea: true, contentItem: { select: { title: true } } },
    }),
    db.userPosition.findUnique({
      where: { userId_topicId: { userId: args.userId, topicId: args.topicId } },
      select: { statement: true },
    }),
  ]);

  const companionContent = await generateSocraticResponse({
    topicName: thread.topic.name,
    positionStatement: position?.statement ?? null,
    captures: topicCaptures.map((c) => ({
      label: c.contentItem?.title ?? "Untitled",
      keyIdea: c.keyIdea,
    })),
    conversationHistory: thread.messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
    userReply: args.content.trim(),
  }) ?? "That's worth sitting with — but push it one step further. What does it mean for the question you started with?";

  const userContent = args.content.trim();

  const [userMessage, companionMessage] = await prisma.$transaction(async (tx) => {
    const u = await tx.socraticMessage.create({
      data: { threadId: thread.id, role: "USER", content: userContent },
    });
    const c = await tx.socraticMessage.create({
      data: { threadId: thread.id, role: "COMPANION", content: companionContent },
    });
    await tx.socraticThread.update({
      where: { id: thread.id },
      data: { updatedAt: new Date() },
    });
    return [u, c] as const;
  });

  return { userMessage, companionMessage };
}
```

- [ ] **Step 2: Run unit tests**

```bash
npm run test:unit
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/server/services/socratic.ts
git commit -m "feat: add socratic service (getOrCreateThread, addUserReply)"
```

---

### Task 12: Socratic API routes

**Files:**
- Modify: `src/server/contracts.ts`
- Create: `src/app/api/socratic/[topicId]/route.ts`
- Create: `src/app/api/socratic/[topicId]/reply/route.ts`

- [ ] **Step 1: Add Zod schema to `src/server/contracts.ts`**

Append at the end of `src/server/contracts.ts`:

```typescript
export const socraticReplySchema = z.object({
  content: z.string().min(1).max(4000),
});
```

- [ ] **Step 2: Create `src/app/api/socratic/[topicId]/route.ts`**

```typescript
import { handleRoute } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { getOrCreateThread } from "@/server/services/socratic";

export async function GET(
  request: Request,
  { params }: { params: { topicId: string } },
) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    return getOrCreateThread({ userId, topicId: params.topicId });
  });
}
```

- [ ] **Step 3: Create `src/app/api/socratic/[topicId]/reply/route.ts`**

```typescript
import { handleRoute, parseJson } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { socraticReplySchema } from "@/server/contracts";
import { addUserReply } from "@/server/services/socratic";

export async function POST(
  request: Request,
  { params }: { params: { topicId: string } },
) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    const input = await parseJson(request, socraticReplySchema);
    return addUserReply({ userId, topicId: params.topicId, content: input.content });
  }, 201);
}
```

- [ ] **Step 4: Run unit tests**

```bash
npm run test:unit
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/contracts.ts "src/app/api/socratic/[topicId]/route.ts" "src/app/api/socratic/[topicId]/reply/route.ts"
git commit -m "feat: add socratic API routes (GET thread, POST reply)"
```

---

### Task 13: Mobile — Socratic companion screen

**Files:**
- Create: `mobile/app/socratic/[topicId].tsx`

- [ ] **Step 1: Create `mobile/app/socratic/[topicId].tsx`**

```typescript
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@/lib/api';
import { Radius, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import type { SocraticMessage } from '@/types/api';

function MessageBubble({ message }: { message: SocraticMessage }) {
  const c = useThemeColors();
  const isCompanion = message.role === 'COMPANION';
  return (
    <View style={[styles.bubble, isCompanion ? styles.companionBubble : styles.userBubble]}>
      {isCompanion && (
        <Text variant="monoSmall" color="muted" style={styles.roleLabel}>companion</Text>
      )}
      <Text
        variant={isCompanion ? 'body' : 'bodyMedium'}
        color={isCompanion ? 'secondary' : 'primary'}
        style={styles.messageText}
      >
        {message.content}
      </Text>
    </View>
  );
}

export default function SocraticScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const { topicId } = useLocalSearchParams<{ topicId: string }>();
  const scrollRef = useRef<ScrollView>(null);

  const [messages, setMessages] = useState<SocraticMessage[]>([]);
  const [topicName, setTopicName] = useState('');
  const [reply, setReply] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadThread = useCallback(async () => {
    if (!topicId) return;
    setLoading(true);
    setError(null);
    try {
      const thread = await api.socratic.getThread(topicId);
      setTopicName(thread.topic.name);
      setMessages(thread.messages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load thread');
    } finally {
      setLoading(false);
    }
  }, [topicId]);

  useEffect(() => {
    void loadThread();
  }, [loadThread]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages]);

  async function handleSend() {
    if (!reply.trim() || sending || !topicId) return;
    const userContent = reply.trim();
    setReply('');
    setSending(true);

    const optimisticUser: SocraticMessage = {
      id: `optimistic-${Date.now()}`,
      role: 'USER',
      content: userContent,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticUser]);

    try {
      const { userMessage, companionMessage } = await api.socratic.reply(topicId, userContent);
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== optimisticUser.id),
        userMessage,
        companionMessage,
      ]);
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticUser.id));
      setError(err instanceof Error ? err.message : 'Failed to send reply');
    } finally {
      setSending(false);
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top', 'bottom']}>
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <Pressable onPress={() => router.back()}>
          <Text variant="body" color="muted">Back</Text>
        </Pressable>
        <Text variant="monoSmall" color="muted">{topicName || '…'}</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {loading ? (
          <ActivityIndicator style={{ flex: 1 }} />
        ) : (
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={styles.messageList}
            keyboardShouldPersistTaps="handled"
          >
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
            {sending && (
              <View style={styles.thinkingRow}>
                <ActivityIndicator size="small" />
                <Text variant="monoSmall" color="muted" style={{ marginLeft: Spacing[2] }}>
                  Thinking…
                </Text>
              </View>
            )}
            {error && (
              <Text variant="monoSmall" style={[styles.errorText, { color: c.destructive }]}>
                {error}
              </Text>
            )}
          </ScrollView>
        )}

        <View style={[styles.inputRow, { borderTopColor: c.border }]}>
          <TextInput
            style={[styles.textInput, { color: c.text, borderColor: c.borderSubtle }]}
            placeholder="Your response…"
            placeholderTextColor={c.faint}
            value={reply}
            onChangeText={setReply}
            multiline
            maxLength={4000}
          />
          <Pressable
            style={[styles.sendBtn, { opacity: reply.trim().length === 0 || sending ? 0.4 : 1 }]}
            onPress={handleSend}
            disabled={reply.trim().length === 0 || sending}
          >
            <Text variant="bodyMedium">→</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  messageList: {
    padding: Spacing[4],
    gap: Spacing[4],
    paddingBottom: Spacing[8],
  },
  bubble: {
    maxWidth: '92%',
  },
  companionBubble: {
    alignSelf: 'flex-start',
  },
  userBubble: {
    alignSelf: 'flex-end',
  },
  roleLabel: {
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: Spacing[1],
  },
  messageText: {
    lineHeight: 24,
  },
  thinkingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginTop: Spacing[2],
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing[2],
    padding: Spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  textInput: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    padding: Spacing[3],
    fontSize: 15,
    lineHeight: 22,
    maxHeight: 120,
  },
  sendBtn: {
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[2],
  },
  errorText: {
    alignSelf: 'center',
    marginTop: Spacing[2],
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add "mobile/app/socratic/[topicId].tsx"
git commit -m "feat: add Socratic companion thread screen"
```

---

### Task 14: Mind tab — Socratic entry points

**Files:**
- Modify: `mobile/app/(tabs)/mind.tsx`

- [ ] **Step 1: Read the full current `mind.tsx` to see current state after Task 9 changes**

Read the file end-to-end before editing.

- [ ] **Step 2: Add socratic button to `PositionCard`**

In the `PositionCard` component (added in Task 9), find the render block for when `position` is not null. After the `captureCountAtCreation` text line, add:

```typescript
      <Pressable
        onPress={() => router.push({ pathname: '/socratic/[topicId]', params: { topicId: position.topicId } })}
        style={[styles.positionCta, { borderTopColor: c.borderSubtle }]}
      >
        <Text variant="monoSmall" color="muted">Open Socratic dialogue →</Text>
      </Pressable>
```

Note: `PositionCard` needs `useRouter()`. Add `const router = useRouter();` at the top of `PositionCard`.

- [ ] **Step 3: Add a positions section to `MindScreen` render**

In `MindScreen`, before the `{data.threadSyntheses.length > 0 && ...}` render block, add:

```typescript
{(positions ?? []).length > 0 && (
  <View>
    <Text variant="monoSmall" color="muted" style={styles.sectionHeader}>
      Positions
    </Text>
    {(positions ?? []).map((position) => (
      <PositionCard
        key={position.topicId}
        position={position}
        onNavigate={() =>
          router.push({ pathname: '/position/[topicId]', params: { topicId: position.topicId } })
        }
      />
    ))}
  </View>
)}
```

- [ ] **Step 4: Add `sectionHeader` to StyleSheet**

In the `StyleSheet.create({...})`, add:

```typescript
  sectionHeader: {
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: Spacing[2],
    paddingHorizontal: Spacing[4],
  },
```

- [ ] **Step 5: Run unit tests**

```bash
npm run test:unit
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add "mobile/app/(tabs)/mind.tsx"
git commit -m "feat: add Positions section and Socratic dialogue entry to Mind tab"
```

---

---

### Task 15: Map tab — surface positions as thesis node indicators

The spec states: "Thesis nodes are visible on a user's public map — not raw captures, not highlights, but the views they've actually committed to."

Rather than a full new node type (which would require restructuring the SVG layout), this task adds a distinct visual indicator on existing topic cluster labels when the user has a position on that topic — surfacing positions within the map without a full architecture change.

**Files:**
- Modify: `src/server/services/memory.ts`
- Modify: `mobile/types/api.ts`
- Modify: `mobile/lib/api.ts`
- Modify: `mobile/app/(tabs)/index.tsx`

- [ ] **Step 1: Add positions to `getMemoryGraph` return in `src/server/services/memory.ts`**

Read the full `getMemoryGraph` function before editing. Then:

After the `clusters` computation, add a query for user positions:
```typescript
const positions = await db.userPosition.findMany({
  where: { userId: args.userId, status: { not: 'ABANDONED' } },
  select: { topicId: true, statement: true, status: true },
});
```

Add `positions` to the return value:
```typescript
return { nodes, edges, clusters, positions };
```

- [ ] **Step 2: Update `MemoryGraphResponse` in `mobile/types/api.ts`**

In the `MemoryGraphResponse` interface, add:
```typescript
  positions: {
    topicId: string;
    statement: string;
    status: 'ACTIVE' | 'REVISED' | 'ABANDONED';
  }[];
```

- [ ] **Step 3: Add position indicator to cluster labels in `mobile/app/(tabs)/index.tsx`**

Read the SVG cluster label rendering section of `index.tsx` to find where topic cluster names are drawn as `<SvgText>` elements.

In that section, find where cluster labels are rendered and add a `·` indicator for clusters that have an associated position:

```typescript
// Build a set of topicIds that have positions (from graphData.positions)
const positionedTopics = new Set((graphData?.positions ?? []).map((p) => p.topicId));

// In the cluster label rendering, where you render the cluster name SvgText:
// After the cluster name text, conditionally render a small marker:
{positionedTopics.has(cluster.topicId) && (
  <SvgText
    x={clusterX}
    y={clusterY + 14}
    textAnchor="middle"
    fontSize={8}
    fill={clusterColor}
    opacity={0.8}
  >
    ◆
  </SvgText>
)}
```

Note: `clusterX`, `clusterY`, and `clusterColor` refer to whatever variable names are used in the existing cluster label rendering code — read the file first.

- [ ] **Step 4: Run unit tests**

```bash
npm run test:unit
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/memory.ts mobile/types/api.ts mobile/lib/api.ts "mobile/app/(tabs)/index.tsx"
git commit -m "feat: surface position indicators on memory map cluster labels"
```

---

## Final Verification

- [ ] **Confirm full test suite passes**

```bash
npm run test:unit
```

Expected: All tests pass (68 pre-existing + 15 new Phase 3 tests = 83 total).

- [ ] **Confirm TypeScript compiles (backend)**

```bash
npx tsc --noEmit 2>&1 | head -40
```

Expected: No errors.

- [ ] **Confirm TypeScript compiles (mobile)**

```bash
cd mobile && npx tsc --noEmit 2>&1 | head -40
```

Expected: No errors.

- [ ] **Confirm Prisma client is up to date**

```bash
npm run prisma:generate
```

Expected: Exits cleanly.
