import { InsightStyle, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/server/db";

export async function getPreferences(args: { userId: string; db?: DbClient }) {
  const db = args.db ?? prisma;
  const existing = await db.userPreference.findUnique({
    where: { userId: args.userId },
  });

  if (existing) {
    return existing;
  }

  return db.userPreference.create({
    data: { userId: args.userId },
  });
}

export async function updatePreferences(args: {
  userId: string;
  insightStyle?: InsightStyle;
  preferences?: Prisma.InputJsonValue;
  db?: DbClient;
}) {
  const db = args.db ?? prisma;

  return db.userPreference.upsert({
    where: { userId: args.userId },
    update: {
      insightStyle: args.insightStyle ?? undefined,
      preferences: args.preferences === undefined ? undefined : args.preferences,
    },
    create: {
      userId: args.userId,
      insightStyle: args.insightStyle ?? InsightStyle.DIRECT,
      preferences: args.preferences ?? Prisma.JsonNull,
    },
  });
}
