import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/api";
import type { DbClient, RootDbClient } from "@/server/db";
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
  db?: RootDbClient;
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
    // Recent turns only — the topic captures above carry the durable context,
    // so an ever-growing history just burns tokens.
    conversationHistory: thread.messages.slice(-16).map((m) => ({
      role: m.role,
      content: m.content,
    })),
    userReply: args.content.trim(),
  }) ?? "That's worth sitting with — but push it one step further. What does it mean for the question you started with?";

  const userContent = args.content.trim();

  const [userMessage, companionMessage] = await db.$transaction(async (tx) => {
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
