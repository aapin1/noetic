import { NotificationStatus, NotificationType, type Prisma } from "@prisma/client";
import { AppError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/server/db";

function buildNotificationCopy(type: NotificationType, actorName: string | null | undefined, deepLink: string): {
  title: string;
  body: string;
  deepLink: string;
} {
  const subject = actorName ?? "Someone";

  switch (type) {
    case NotificationType.NEW_FOLLOW:
      return {
        title: `${subject} followed you`,
        body: `${subject} is now following your intellectual profile.`,
        deepLink,
      };
    case NotificationType.NEW_LIKE:
      return {
        title: `${subject} liked your review`,
        body: `${subject} liked one of your public reviews.`,
        deepLink,
      };
    case NotificationType.NEW_COMMENT:
      return {
        title: `${subject} commented on your review`,
        body: `${subject} added a comment to one of your reviews.`,
        deepLink,
      };
    case NotificationType.NEW_REPLY:
      return {
        title: `${subject} replied to your comment`,
        body: `${subject} replied in a discussion you joined.`,
        deepLink,
      };
    case NotificationType.RANKING_UPDATED:
      return {
        title: `${subject} updated a ranking`,
        body: `${subject} updated a ranking list you follow.`,
        deepLink,
      };
  }

  throw new AppError("INVALID_NOTIFICATION_TYPE", "Unsupported notification type", 500);
}

export async function createNotification(args: {
  db?: DbClient;
  recipientId: string;
  actorId?: string;
  type: NotificationType;
  deepLink: string;
  payload?: Record<string, unknown>;
}) {
  const db = args.db ?? prisma;
  const actor = args.actorId
    ? await db.user.findUnique({
        where: { id: args.actorId },
        select: { name: true, profile: { select: { displayName: true, handle: true } } },
      })
    : null;
  const actorName = actor?.profile?.displayName ?? actor?.name;
  const copy = buildNotificationCopy(args.type, actorName, args.deepLink);

  return db.notification.create({
    data: {
      recipientId: args.recipientId,
      actorId: args.actorId,
      type: args.type,
      title: copy.title,
      body: copy.body,
      deepLink: copy.deepLink,
      payload: (args.payload ?? {}) as Prisma.InputJsonValue,
    },
  });
}

export async function registerDeviceToken(args: {
  userId: string;
  token: string;
  platform: "IOS" | "ANDROID" | "WEB";
  provider: "APNS" | "FCM" | "EXPO";
}, db: DbClient = prisma) {
  return db.deviceToken.upsert({
    where: {
      provider_token: {
        provider: args.provider,
        token: args.token,
      },
    },
    update: {
      userId: args.userId,
      platform: args.platform,
      isActive: true,
    },
    create: {
      userId: args.userId,
      token: args.token,
      platform: args.platform,
      provider: args.provider,
    },
  });
}

export async function prepareNotificationPayloads(args: {
  notificationIds?: string[];
  recipientId?: string;
}, db: DbClient = prisma) {
  const notifications = await db.notification.findMany({
    where: {
      status: NotificationStatus.PENDING,
      ...(args.notificationIds?.length
        ? { id: { in: args.notificationIds } }
        : args.recipientId
          ? { recipientId: args.recipientId }
          : {}),
    },
    include: {
      recipient: {
        include: {
          deviceTokens: {
            where: { isActive: true },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  if (notifications.length === 0) {
    return [] as Array<Record<string, unknown>>;
  }

  const payloads = notifications.flatMap((notification) =>
    notification.recipient.deviceTokens.map((deviceToken) => ({
      notificationId: notification.id,
      userId: notification.recipientId,
      token: deviceToken.token,
      provider: deviceToken.provider,
      platform: deviceToken.platform,
      payload: {
        title: notification.title,
        body: notification.body,
        deepLink: notification.deepLink,
        data: notification.payload,
      },
    })),
  );

  if (payloads.length === 0) {
    throw new AppError("NO_DEVICE_TOKENS", "No active device tokens are registered for the selected notifications", 409);
  }

  await db.notification.updateMany({
    where: {
      id: { in: notifications.map((notification) => notification.id) },
    },
    data: {
      status: NotificationStatus.SENT,
      sentAt: new Date(),
    },
  });

  return payloads;
}
