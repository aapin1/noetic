import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/api";
import type { DbClient } from "@/server/db";
import { embedText, generateCompanionResponse } from "@/server/cognition/llm";
import { cosineSim } from "@/server/cognition/layout";

// How many captures to consider at all (newest-first DB scan) vs. how many
// actually enter the prompt. Below CONTEXT_CAP everything goes in verbatim;
// above it, the prompt gets the most recent ones plus the ones most relevant
// to the current message (by embedding similarity) — so prompt size stays
// bounded no matter how large the map grows.
const CAPTURE_SCAN_LIMIT = 150;
const CONTEXT_CAP = 40;
const RECENT_LIMIT = 12;
const RELEVANT_LIMIT = 24;
const EDGE_LIMIT = 60;

const DEFAULT_OPENING =
  "Your knowledge map is ready. Ask me anything about your captures, topics, or the connections between them.";

type ContextCapture = {
  id: string;
  rawText: string | null;
  caption: string | null;
  keyIdea: string | null;
  summary: string | null;
  userContext: string | null;
  embedding: number[];
  contentItem: { title: string } | null;
};

/** One short line of substance per capture — link captures have rawText = null,
 * so without the summary/userContext fallback the companion only saw titles. */
function captureGist(c: ContextCapture): string {
  const gist = [c.keyIdea, c.userContext, c.summary, c.rawText, c.caption]
    .find((part) => part && part.trim().length > 0) ?? "";
  const cleaned = gist.replace(/\s+/g, " ").trim();
  return cleaned.length > 140 ? `${cleaned.slice(0, 137).trimEnd()}…` : cleaned;
}

async function buildCompanionContext(
  userId: string,
  db: DbClient,
  userMessage: string,
): Promise<string> {
  const [userTopics, positions, captures] = await Promise.all([
    db.userTopic.findMany({
      where: { userId },
      orderBy: { weight: "desc" },
      include: {
        topic: {
          include: { _count: { select: { capturedTags: { where: { capturedItem: { userId } } } } } },
        },
      },
    }),
    db.userPosition.findMany({
      where: { userId, status: "ACTIVE" },
      include: { topic: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
    db.capturedItem.findMany({
      where: { userId },
      orderBy: { capturedAt: "desc" },
      take: CAPTURE_SCAN_LIMIT,
      select: {
        id: true,
        rawText: true,
        caption: true,
        keyIdea: true,
        summary: true,
        userContext: true,
        embedding: true,
        contentItem: { select: { title: true } },
      },
    }),
  ]);

  // Stable newest-first numbering over the scanned set, so "Capture #4" means
  // the same thing whether or not #4 made it into this turn's context.
  const captureIndex = new Map(captures.map((c, i) => [c.id, i + 1]));

  let included: ContextCapture[] = captures;
  if (captures.length > CONTEXT_CAP) {
    const chosen = new Set(captures.slice(0, RECENT_LIMIT).map((c) => c.id));
    const queryEmbedding = await embedText(userMessage);

    if (queryEmbedding) {
      const ranked = captures
        .filter((c) => !chosen.has(c.id) && c.embedding.length > 0)
        .map((c) => ({ c, score: cosineSim(queryEmbedding, c.embedding) }))
        .sort((a, b) => b.score - a.score);
      for (const { c } of ranked.slice(0, RELEVANT_LIMIT)) chosen.add(c.id);
    } else {
      // Embedding unavailable: degrade to plain recency.
      for (const c of captures.slice(0, CONTEXT_CAP)) chosen.add(c.id);
    }

    included = captures.filter((c) => chosen.has(c.id));
  }

  const includedIds = new Set(included.map((c) => c.id));
  const edges = includedIds.size > 0
    ? await db.memoryEdge.findMany({
        where: {
          userId,
          fromItemId: { in: Array.from(includedIds) },
          toItemId: { in: Array.from(includedIds) },
        },
        select: { fromItemId: true, toItemId: true, type: true },
        take: EDGE_LIMIT,
      })
    : [];

  const topicsLine = userTopics
    .map((ut) => {
      const count = ut.topic._count.capturedTags;
      return `${ut.topic.name} (${count})`;
    })
    .join(", ");

  const positionsBlock =
    positions.length > 0
      ? positions.map((p) => `- ${p.topic.name}: "${p.statement}"`).join("\n")
      : "None yet.";

  const capturesBlock = included
    .map((c) => {
      const title = c.contentItem?.title ?? c.rawText?.slice(0, 80) ?? c.caption?.slice(0, 80) ?? "Untitled";
      const gist = captureGist(c);
      const idea = gist && gist !== title ? ` — ${gist}` : "";
      return `${captureIndex.get(c.id)}. "${title}"${idea}`;
    })
    .join("\n");

  const capturesHeading =
    included.length === captures.length
      ? `Captures (newest-first, ${captures.length} shown):`
      : `Captures (numbered newest-first; showing the ${included.length} most recent/relevant of ${captures.length}):`;

  const edgesBlock =
    edges.length > 0
      ? edges
          .map((e) => `- #${captureIndex.get(e.fromItemId)} ${e.type} #${captureIndex.get(e.toItemId)}`)
          .join("\n")
      : "No connections yet.";

  return [
    "--- KNOWLEDGE MAP ---",
    `Topics (${userTopics.length}): ${topicsLine || "none"}`,
    "",
    "Positions:",
    positionsBlock,
    "",
    capturesHeading,
    capturesBlock,
    "",
    "Connections:",
    edgesBlock,
    "--- END MAP ---",
  ].join("\n");
}

async function buildFocusBlock(
  userId: string,
  itemIds: string[],
  db: DbClient,
): Promise<string | undefined> {
  const items = await db.capturedItem.findMany({
    where: { id: { in: itemIds }, userId },
    select: {
      rawText: true,
      keyIdea: true,
      summary: true,
      userContext: true,
      contentItem: { select: { title: true, description: true } },
    },
  });
  if (items.length === 0) return undefined;

  const lines = items.map((it, i) => {
    const title = it.contentItem?.title ?? it.rawText?.slice(0, 80) ?? "Untitled";
    const gist = [it.keyIdea, it.userContext, it.summary, it.contentItem?.description, it.rawText]
      .find((part) => part && part.trim().length > 0)
      ?.replace(/\s+/g, " ")
      .trim()
      .slice(0, 240);
    const idea = gist && gist !== title ? ` — ${gist}` : "";
    return `${i + 1}. "${title}"${idea}`;
  });

  return ["--- FOCUS FOR THIS REPLY ---", ...lines, "--- END FOCUS ---"].join("\n");
}

export async function getOrCreateCompanionThread(args: {
  userId: string;
  db?: DbClient;
}) {
  const db = args.db ?? prisma;

  const existing = await db.companionThread.findUnique({
    where: { userId: args.userId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });

  if (existing) return existing;

  return db.companionThread.create({
    data: {
      userId: args.userId,
      messages: {
        create: { role: "COMPANION", content: DEFAULT_OPENING },
      },
    },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
}

export async function addCompanionReply(args: {
  userId: string;
  content: string;
  contextItemIds?: string[];
  db?: DbClient;
}) {
  if (!args.content.trim()) {
    throw new AppError("EMPTY_REPLY", "Reply cannot be empty", 422);
  }

  const db = args.db ?? prisma;

  const thread = await db.companionThread.findUnique({
    where: { userId: args.userId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });

  if (!thread) {
    throw new AppError("THREAD_NOT_FOUND", "Thread not found — call GET to initialise it", 404);
  }

  const [contextBlock, focusBlock] = await Promise.all([
    buildCompanionContext(args.userId, db, args.content.trim()),
    args.contextItemIds && args.contextItemIds.length > 0
      ? buildFocusBlock(args.userId, args.contextItemIds, db)
      : Promise.resolve(undefined),
  ]);

  const companionContent =
    (await generateCompanionResponse({
      contextBlock,
      focusBlock,
      // Only the recent turns: the knowledge-map context block carries the
      // durable state, so an ever-growing history just burns tokens.
      conversationHistory: thread.messages.slice(-16).map((m) => ({
        role: m.role,
        content: m.content,
      })),
      userMessage: args.content.trim(),
    })) ?? "That's worth exploring — but push it one step further. What specific connection are you trying to trace?";

  const userContent = args.content.trim();

  const [userMessage, companionMessage] = await prisma.$transaction(async (tx: DbClient) => {
    const u = await tx.companionMessage.create({
      data: { threadId: thread.id, role: "USER", content: userContent },
    });
    const c = await tx.companionMessage.create({
      data: { threadId: thread.id, role: "COMPANION", content: companionContent },
    });
    await tx.companionThread.update({
      where: { id: thread.id },
      data: { updatedAt: new Date() },
    });
    return [u, c] as const;
  });

  return { userMessage, companionMessage };
}
