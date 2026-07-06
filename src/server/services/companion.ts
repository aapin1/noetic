import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/api";
import type { DbClient } from "@/server/db";
import { generateCompanionResponse } from "@/server/cognition/llm";

const CAPTURE_LIMIT = 100;

const DEFAULT_OPENING =
  "Your knowledge map is ready. Ask me anything about your captures, topics, or the connections between them.";

async function buildCompanionContext(userId: string, db: DbClient): Promise<string> {
  const [userTopics, positions, captures, edges] = await Promise.all([
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
      take: CAPTURE_LIMIT,
      select: {
        id: true,
        rawText: true,
        caption: true,
        keyIdea: true,
        contentItem: { select: { title: true } },
      },
    }),
    db.memoryEdge.findMany({
      where: { userId },
      select: { fromItemId: true, toItemId: true, type: true },
    }),
  ]);

  const captureIndex = new Map(captures.map((c, i) => [c.id, i + 1]));

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

  const capturesBlock = captures
    .map((c, i) => {
      const title = c.contentItem?.title ?? c.rawText?.slice(0, 80) ?? c.caption?.slice(0, 80) ?? "Untitled";
      const idea = c.keyIdea ? ` — ${c.keyIdea}` : "";
      return `${i + 1}. "${title}"${idea}`;
    })
    .join("\n");

  const edgesBlock =
    edges.length > 0
      ? edges
          .filter((e) => captureIndex.has(e.fromItemId) && captureIndex.has(e.toItemId))
          .map((e) => `- #${captureIndex.get(e.fromItemId)} ${e.type} #${captureIndex.get(e.toItemId)}`)
          .slice(0, 80)
          .join("\n")
      : "No connections yet.";

  return [
    "--- KNOWLEDGE MAP ---",
    `Topics (${userTopics.length}): ${topicsLine || "none"}`,
    "",
    "Positions:",
    positionsBlock,
    "",
    `Captures (newest-first, ${captures.length} shown):`,
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
