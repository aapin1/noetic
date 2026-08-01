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

export type PushPreferenceInput = {
  quietHoursStartHour?: number;
  quietHoursEndHour?: number;
  pushSocial?: boolean;
  pushResurface?: boolean;
  pushStreak?: boolean;
};

/**
 * Update a user's preferences.
 *
 * Note the shape of the `update` block: every field is `?? undefined`, which
 * Prisma reads as "leave this column alone". That matters more than it looks.
 * This row has two writers — a settings save from the app, and the hourly
 * notification job recording the client's clock and any freeze it spent — and
 * they are not coordinated. Writing only the columns the caller actually named
 * is what keeps the two from clobbering each other. The push fields are
 * columns rather than keys inside `preferences` for exactly this reason:
 * `preferences` is replaced wholesale, so anything sharing it is at the mercy
 * of whoever wrote last.
 */
export async function updatePreferences(args: {
  userId: string;
  insightStyle?: InsightStyle;
  preferences?: Prisma.InputJsonValue;
  db?: DbClient;
} & PushPreferenceInput) {
  const db = args.db ?? prisma;

  const push = {
    quietHoursStartHour: args.quietHoursStartHour ?? undefined,
    quietHoursEndHour: args.quietHoursEndHour ?? undefined,
    pushSocial: args.pushSocial ?? undefined,
    pushResurface: args.pushResurface ?? undefined,
    pushStreak: args.pushStreak ?? undefined,
  };

  return db.userPreference.upsert({
    where: { userId: args.userId },
    update: {
      insightStyle: args.insightStyle ?? undefined,
      preferences: args.preferences === undefined ? undefined : args.preferences,
      ...push,
    },
    create: {
      userId: args.userId,
      insightStyle: args.insightStyle ?? InsightStyle.DIRECT,
      preferences: args.preferences ?? Prisma.JsonNull,
      ...push,
    },
  });
}
