import { AppError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/server/db";
import { normalizeTopicName, upsertTopics } from "@/server/topics";
import { applyTopicWeights, incrementTasteProfileVersion } from "@/server/services/activity";

/**
 * "Move to…": the user corrects the AI's filing. The correction is decisive —
 * the capture's machine-derived topic rows are replaced by the one chosen
 * topic at weight 1.0 (the primary-anchor weight), marked userSet so later
 * re-classification re-pins rather than reverts it.
 *
 * The tail mirrors what updateCaptureContext triggers for re-mapping: map
 * coords are nulled so the semantic layout re-seats the node, and the taste
 * profile version bump invalidates the intelligence cache.
 */

export type MovedTopic = { topicId: string; name: string; slug: string };

export async function moveCaptureTopic(args: {
  userId: string;
  capturedItemId: string;
  topicId?: string;
  topicName?: string;
  db?: DbClient;
}): Promise<MovedTopic> {
  const run = async (db: DbClient): Promise<MovedTopic> => {
    const item = await db.capturedItem.findFirst({
      where: { id: args.capturedItemId, userId: args.userId },
      select: { id: true, topics: { select: { topicId: true } } },
    });
    if (!item) {
      throw new AppError("CAPTURE_NOT_FOUND", "That capture does not exist.", 404);
    }

    let target: MovedTopic;
    if (args.topicId) {
      const topic = await db.topic.findUnique({
        where: { id: args.topicId },
        select: { id: true, name: true, slug: true },
      });
      if (!topic) {
        throw new AppError("TOPIC_NOT_FOUND", "That topic does not exist.", 404);
      }
      target = { topicId: topic.id, name: topic.name, slug: topic.slug };
    } else {
      const name = normalizeTopicName(args.topicName ?? "");
      if (!name) {
        throw new AppError("TOPIC_REQUIRED", "Name the topic to move to.", 422);
      }
      const [created] = await upsertTopics(db, [name]);
      target = { topicId: created.id, name: created.name, slug: created.slug };
    }

    const oldIds = item.topics.map((row) => row.topicId);
    await db.capturedItemTopic.deleteMany({ where: { capturedItemId: item.id } });
    await db.capturedItemTopic.create({
      data: { capturedItemId: item.id, topicId: target.topicId, weight: 1, userSet: true },
    });

    const removed = oldIds.filter((id) => id !== target.topicId);
    if (removed.length > 0) {
      await applyTopicWeights({ db, userId: args.userId, topicIds: removed, increment: -1 });
    }
    if (!oldIds.includes(target.topicId)) {
      await applyTopicWeights({ db, userId: args.userId, topicIds: [target.topicId], increment: 1 });
    }

    // Cleared so the semantic layout re-seats the node under its new filing.
    await db.capturedItem.update({ where: { id: item.id }, data: { mapX: null, mapY: null } });
    await incrementTasteProfileVersion(db, args.userId);

    return target;
  };

  return args.db ? run(args.db) : prisma.$transaction(run);
}

export type UserSetTopicRow = { topicId: string; weight: number };

/** The rows to re-pin before updateCaptureContext wipes the assignment set. */
export async function snapshotUserSetTopics(args: {
  capturedItemId: string;
  db?: DbClient;
}): Promise<UserSetTopicRow[]> {
  const db = args.db ?? prisma;
  return db.capturedItemTopic.findMany({
    where: { capturedItemId: args.capturedItemId, userSet: true },
    select: { topicId: true, weight: true },
  });
}

/**
 * Re-pin user-set rows after re-classification rewrote the assignment set.
 * If the classifier re-derived the same topic, the row just gets its userSet
 * mark back (keeping the stronger weight); if it dropped the topic, the row
 * is recreated and the user-topic weight the wipe subtracted is restored.
 */
export async function restoreUserSetTopics(args: {
  userId: string;
  capturedItemId: string;
  rows: UserSetTopicRow[];
  db?: DbClient;
}): Promise<void> {
  if (args.rows.length === 0) return;

  const run = async (db: DbClient): Promise<void> => {
    for (const row of args.rows) {
      const key = { capturedItemId: args.capturedItemId, topicId: row.topicId };
      const existing = await db.capturedItemTopic.findUnique({
        where: { capturedItemId_topicId: key },
        select: { weight: true },
      });
      if (existing) {
        await db.capturedItemTopic.update({
          where: { capturedItemId_topicId: key },
          data: { userSet: true, weight: Math.max(existing.weight, row.weight) },
        });
      } else {
        await db.capturedItemTopic.create({
          data: { ...key, weight: row.weight, userSet: true },
        });
        await applyTopicWeights({
          db,
          userId: args.userId,
          topicIds: [row.topicId],
          increment: 1,
        });
      }
    }
  };

  return args.db ? run(args.db) : prisma.$transaction(run);
}
