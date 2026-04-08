import { Visibility } from "@prisma/client";
import { AppError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { createApiToken, createPasswordHash } from "@/lib/auth";
import type { DbClient, RootDbClient } from "@/server/db";
import { upsertTopics } from "@/server/topics";
import { applyTopicWeights, incrementTasteProfileVersion, recordActivityEvent } from "@/server/services/activity";
import { recomputeProfileSummary } from "@/server/services/profile";

async function assertEmailAvailable(db: DbClient | RootDbClient, email: string) {
  const existing = await db.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { id: true },
  });

  if (existing) {
    throw new AppError("EMAIL_IN_USE", "An account with this email already exists", 409);
  }
}

async function assertHandleAvailable(db: DbClient | RootDbClient, handle: string, currentUserId?: string) {
  const existing = await db.profile.findUnique({
    where: { handle },
    select: { userId: true },
  });

  if (existing && existing.userId !== currentUserId) {
    throw new AppError("HANDLE_IN_USE", "That handle is already taken", 409);
  }
}

export async function registerUser(args: {
  email: string;
  password: string;
  name?: string;
  db?: RootDbClient;
}) {
  const db = args.db ?? prisma;
  const email = args.email.toLowerCase();
  await assertEmailAvailable(db, email);
  const passwordHash = await createPasswordHash(args.password);

  const user = await db.user.create({
    data: {
      email,
      passwordHash,
      name: args.name,
    },
  });

  const token = await createApiToken(user.id);

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
    },
    token,
  };
}

export async function createAccessToken(args: {
  userId: string;
}) {
  const user = await prisma.user.findUnique({
    where: { id: args.userId },
    select: { id: true },
  });

  if (!user) {
    throw new AppError("USER_NOT_FOUND", "User not found", 404);
  }

  return {
    token: await createApiToken(user.id),
  };
}

export async function createOnboardingProfile(args: {
  userId: string;
  handle: string;
  displayName: string;
  bio?: string;
  publicNotes?: string;
  avatarUrl?: string;
  topics: string[];
  db?: RootDbClient;
}) {
  const db = args.db ?? prisma;
  const handle = args.handle.toLowerCase();
  await assertHandleAvailable(db, handle, args.userId);

  return db.$transaction(async (tx: DbClient) => {
    const topicRecords = await upsertTopics(tx, args.topics);

    const profile = await tx.profile.upsert({
      where: { userId: args.userId },
      update: {
        handle,
        displayName: args.displayName,
        bio: args.bio,
        publicNotes: args.publicNotes,
        avatarUrl: args.avatarUrl,
        isOnboarded: true,
      },
      create: {
        userId: args.userId,
        handle,
        displayName: args.displayName,
        bio: args.bio,
        publicNotes: args.publicNotes,
        avatarUrl: args.avatarUrl,
        isOnboarded: true,
      },
    });

    if (topicRecords.length > 0) {
      await applyTopicWeights({
        db: tx,
        userId: args.userId,
        topicIds: topicRecords.map((topic) => topic.id),
        increment: 2,
      });
    }

    await recordActivityEvent({
      db: tx,
      actorId: args.userId,
      type: "PROFILE_UPDATED",
      weight: 1,
      visibility: Visibility.PUBLIC,
      metadata: {
        profileId: profile.id,
        topicCount: topicRecords.length,
      },
    });
    await incrementTasteProfileVersion(tx, args.userId);
    await recomputeProfileSummary(args.userId, tx);

    return tx.profile.findUniqueOrThrow({
      where: { userId: args.userId },
    });
  });
}

export async function updateProfile(args: {
  userId: string;
  handle?: string;
  displayName?: string;
  bio?: string;
  publicNotes?: string;
  avatarUrl?: string;
  topics?: string[];
  db?: RootDbClient;
}) {
  const db = args.db ?? prisma;
  const existing = await db.profile.findUnique({
    where: { userId: args.userId },
  });

  if (!existing) {
    throw new AppError("PROFILE_NOT_FOUND", "Profile not found", 404);
  }

  if (args.handle) {
    await assertHandleAvailable(db, args.handle.toLowerCase(), args.userId);
  }

  return db.$transaction(async (tx: DbClient) => {
    const profile = await tx.profile.update({
      where: { userId: args.userId },
      data: {
        handle: args.handle?.toLowerCase(),
        displayName: args.displayName,
        bio: args.bio,
        publicNotes: args.publicNotes,
        avatarUrl: args.avatarUrl,
      },
    });

    if (args.topics) {
      const topicRecords = await upsertTopics(tx, args.topics);
      await applyTopicWeights({
        db: tx,
        userId: args.userId,
        topicIds: topicRecords.map((topic) => topic.id),
        increment: 1,
      });
    }

    await recordActivityEvent({
      db: tx,
      actorId: args.userId,
      type: "PROFILE_UPDATED",
      weight: 1,
      visibility: Visibility.PUBLIC,
      metadata: {
        profileId: profile.id,
      },
    });
    await incrementTasteProfileVersion(tx, args.userId);
    await recomputeProfileSummary(args.userId, tx);

    return tx.profile.findUniqueOrThrow({
      where: { userId: args.userId },
    });
  });
}
