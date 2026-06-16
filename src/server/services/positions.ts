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
  try {
    return await db.userPosition.create({
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
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'P2002') {
      throw new AppError("POSITION_EXISTS", "A position already exists for this topic", 409);
    }
    throw err;
  }
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
    orderBy: { createdAt: "desc" },
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

  const challenge = await db.positionChallenge.upsert({
    where: { positionId_capturedItemId: { positionId: position.id, capturedItemId: args.capturedItemId } },
    create: { positionId: position.id, capturedItemId: args.capturedItemId, tension },
    update: {},
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

  // verify ownership outside tx (read-only, cheap)
  const challenge = await db.positionChallenge.findUnique({
    where: { id: args.challengeId },
    include: { position: { select: { userId: true, id: true } } },
  });

  if (!challenge || challenge.position.userId !== args.userId) {
    throw new AppError("CHALLENGE_NOT_FOUND", "Challenge not found", 404);
  }

  await db.$transaction(async (tx) => {
    const locked = await tx.positionChallenge.findUnique({
      where: { id: args.challengeId },
    });
    if (!locked || locked.acknowledged) {
      throw new AppError("ALREADY_ACKNOWLEDGED", "Challenge already acknowledged", 409);
    }
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
