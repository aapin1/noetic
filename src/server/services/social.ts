import { ActivityType, NotificationType, Visibility, type Prisma } from "@prisma/client";
import { AppError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/server/db";
import { SIGNAL_WEIGHTS, TOP_FOLLOW_TOPICS } from "@/server/weights";
import { createNotification } from "@/server/services/notifications";
import { applyTopicWeights, getPublicTopicIdsForUser, incrementTasteProfileVersion, recordActivityEvent } from "@/server/services/activity";
import { blockedUserIds } from "@/server/services/moderation";
import { recomputeProfileSummary } from "@/server/services/profile";
import { getMemoryGraph, nodeLabel } from "@/server/services/memory";
import { getCaptureWrappedStats } from "@/server/services/wrapped";
import { isGeneralTopic } from "@/server/cognition/generalTopics";

export async function followUser(userId: string, targetUserId: string, db: DbClient = prisma) {
  if (userId === targetUserId) {
    throw new AppError("INVALID_FOLLOW", "You cannot follow yourself", 400);
  }

  const target = await db.user.findUnique({
    where: { id: targetUserId },
    select: { id: true },
  });

  if (!target) {
    throw new AppError("USER_NOT_FOUND", "Target user not found", 404);
  }

  // A block has to survive the follow button. Checked in both directions so
  // neither party can re-establish the edge the block just severed. The message
  // is deliberately non-committal — telling someone "they blocked you" is itself
  // a thing an abusive account can act on.
  const block = await db.userBlock.findFirst({
    where: {
      OR: [
        { blockerId: userId, blockedId: targetUserId },
        { blockerId: targetUserId, blockedId: userId },
      ],
    },
    select: { id: true },
  });
  if (block) {
    throw new AppError("BLOCKED", "You can't follow this account", 403);
  }

  const existing = await db.follow.findUnique({
    where: {
      followerId_followingId: {
        followerId: userId,
        followingId: targetUserId,
      },
    },
  });

  if (existing) {
    throw new AppError("ALREADY_FOLLOWING", "You already follow this user", 409);
  }

  const follow = await db.follow.create({
    data: {
      followerId: userId,
      followingId: targetUserId,
    },
  });

  const topicIds = await getPublicTopicIdsForUser(db, targetUserId, TOP_FOLLOW_TOPICS);
  await applyTopicWeights({
    db,
    userId,
    topicIds,
    increment: SIGNAL_WEIGHTS.followTopicBoost,
  });
  await recordActivityEvent({
    db,
    actorId: userId,
    targetUserId,
    followId: follow.id,
    type: ActivityType.FOLLOWED_USER,
    weight: SIGNAL_WEIGHTS.followTopicBoost,
    visibility: Visibility.PUBLIC,
  });
  await createNotification({
    db,
    recipientId: targetUserId,
    actorId: userId,
    type: NotificationType.NEW_FOLLOW,
    deepLink: `/profile/${userId}`,
    payload: { targetUserId },
  });
  await incrementTasteProfileVersion(db, userId);
  await recomputeProfileSummary(userId, db);

  return {
    following: true,
    follow,
  };
}

export async function unfollowUser(userId: string, targetUserId: string, db: DbClient = prisma) {
  const existing = await db.follow.findUnique({
    where: {
      followerId_followingId: {
        followerId: userId,
        followingId: targetUserId,
      },
    },
  });

  if (!existing) {
    throw new AppError("FOLLOW_NOT_FOUND", "Follow relationship not found", 404);
  }

  await db.follow.delete({
    where: { id: existing.id },
  });

  await incrementTasteProfileVersion(db, userId);
  await recomputeProfileSummary(userId, db);

  return {
    following: false,
    targetUserId,
  };
}

export async function likeReview(userId: string, reviewId: string, db: DbClient = prisma) {
  const review = await db.review.findUnique({
    where: { id: reviewId },
    include: {
      author: true,
      logEntry: true,
      _count: {
        select: { likes: true },
      },
    },
  });

  if (!review || review.visibility === Visibility.PRIVATE) {
    throw new AppError("REVIEW_NOT_FOUND", "Review not found", 404);
  }

  const existing = await db.like.findUnique({
    where: {
      userId_reviewId: {
        userId,
        reviewId,
      },
    },
  });

  if (existing) {
    throw new AppError("ALREADY_LIKED", "You already liked this review", 409);
  }

  const like = await db.like.create({
    data: {
      userId,
      reviewId,
    },
  });

  if (review.authorId !== userId) {
    await createNotification({
      db,
      recipientId: review.authorId,
      actorId: userId,
      type: NotificationType.NEW_LIKE,
      deepLink: `/content/${review.logEntry.contentItemId}`,
      payload: { reviewId },
    });
  }

  return {
    liked: true,
    like,
    likeCount: review._count.likes + 1,
  };
}

export async function saveContent(userId: string, contentItemId: string, db: DbClient = prisma) {
  const contentItem = await db.contentItem.findUnique({
    where: { id: contentItemId },
    include: {
      topics: {
        select: { topicId: true },
      },
    },
  });

  if (!contentItem) {
    throw new AppError("CONTENT_NOT_FOUND", "Content item not found", 404);
  }

  const existing = await db.save.findUnique({
    where: {
      userId_contentItemId: {
        userId,
        contentItemId,
      },
    },
  });

  if (existing) {
    throw new AppError("ALREADY_SAVED", "You already saved this content", 409);
  }

  const save = await db.save.create({
    data: {
      userId,
      contentItemId,
    },
  });

  await applyTopicWeights({
    db,
    userId,
    topicIds: contentItem.topics.map((topic) => topic.topicId),
    increment: SIGNAL_WEIGHTS.save,
  });
  await recordActivityEvent({
    db,
    actorId: userId,
    contentItemId,
    type: ActivityType.SAVED_CONTENT,
    weight: SIGNAL_WEIGHTS.save,
    visibility: Visibility.PUBLIC,
  });
  await incrementTasteProfileVersion(db, userId);
  await recomputeProfileSummary(userId, db);

  return {
    saved: true,
    save,
  };
}

export async function getFeed(args: {
  userId: string;
  cursor?: string;
  limit?: number;
  db?: DbClient;
}) {
  const db = args.db ?? prisma;
  const limit = Math.min(args.limit ?? 20, 40);

  const follows = await db.follow.findMany({
    where: { followerId: args.userId },
    select: { followingId: true },
  });

  const followedIds = follows.map((f) => f.followingId);

  if (followedIds.length === 0) {
    return { items: [], nextCursor: null };
  }

  const where: Prisma.CapturedItemWhereInput = {
    userId: { in: followedIds },
    ...(args.cursor
      ? { capturedAt: { lt: new Date(args.cursor) } }
      : {}),
  };

  const captures = await db.capturedItem.findMany({
    where,
    orderBy: { capturedAt: "desc" },
    take: limit + 1,
    // Narrow select: the feed shows a title, a gist and topic names, but
    // `include` was shipping each capture's embedding along with them.
    select: {
      id: true,
      kind: true,
      capturedAt: true,
      rawText: true,
      caption: true,
      summary: true,
      keyIdea: true,
      reaction: true,
      userTitle: true,
      userId: true,
      contentItem: { select: { title: true } },
      topics: { select: { topicId: true, topic: { select: { name: true } } } },
      user: {
        select: {
          id: true,
          profile: { select: { handle: true, displayName: true, avatarUrl: true } },
        },
      },
    },
  });

  const hasMore = captures.length > limit;
  const page = hasMore ? captures.slice(0, limit) : captures;
  const nextCursor = hasMore ? page[page.length - 1]!.capturedAt.toISOString() : null;

  const items = page.map((item) => ({
    id: item.id,
    capturedAt: item.capturedAt.toISOString(),
    title: item.contentItem?.title ?? item.rawText?.slice(0, 120) ?? item.caption?.slice(0, 120) ?? null,
    rawText: item.rawText,
    keyIdea: item.keyIdea,
    kind: item.kind,
    topics: item.topics.map((row) => ({ topicId: row.topicId, name: row.topic.name })),

    author: {
      id: item.user.id,
      handle: item.user.profile?.handle ?? item.user.id,
      displayName: item.user.profile?.displayName ?? "Unknown",
      avatarUrl: item.user.profile?.avatarUrl ?? null,
    },
  }));

  return { items, nextCursor };
}

// How much of each followed person's world the pulse shows at a glance: enough
// nodes to read the shape of their map, a handful of their most recent logs.
const PULSE_MAP_NODES = 60;
const USER_SEARCH_LIMIT = 20;

/** Shortest query a trigram index can serve; below this Postgres ignores it. */
const TRIGRAM_MIN_LENGTH = 3;

type ProfileSearchRow = {
  userId: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
};

/** `%`, `_` and `\` are LIKE wildcards — a raw `%` would otherwise match everyone. */
function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Find people by handle or display name.
 *
 * Two paths, because a trigram index cannot serve a query shorter than three
 * characters:
 *
 * - 1-2 chars: handle prefix only, in handle order. Handles are stored
 *   lowercase, so the btree on `handle` supplies the ordering and Postgres
 *   stops as soon as it has filled the limit instead of reading the table.
 * - 3+ chars: substring and fuzzy matching over handle and display name,
 *   served by the trigram indexes, then ranked so the closest match is first.
 *
 * Either way the database returns at most USER_SEARCH_LIMIT already-ranked
 * rows, so the cost is flat as the user table grows.
 */
export async function searchProfiles(args: { userId: string; query: string; db?: DbClient }) {
  const db = args.db ?? prisma;
  const query = args.query.trim().toLowerCase();

  if (!query) return { users: [] };

  const prefix = `${escapeLike(query)}%`;

  const rows =
    query.length < TRIGRAM_MIN_LENGTH
      ? await db.$queryRaw<ProfileSearchRow[]>`
          SELECT p."userId", p."handle", p."displayName", p."avatarUrl"
          FROM "Profile" p
          WHERE p."userId" <> ${args.userId}
            AND p."handle" LIKE ${prefix}
          ORDER BY p."handle" ASC
          LIMIT ${USER_SEARCH_LIMIT}
        `
      : await db.$queryRaw<ProfileSearchRow[]>`
          SELECT p."userId", p."handle", p."displayName", p."avatarUrl"
          FROM "Profile" p
          WHERE p."userId" <> ${args.userId}
            AND (
              p."handle" ILIKE ${`%${escapeLike(query)}%`}
              OR p."displayName" ILIKE ${`%${escapeLike(query)}%`}
              OR p."handle" % ${query}
              OR p."displayName" % ${query}
            )
          ORDER BY
            CASE
              WHEN p."handle" = ${query} THEN 0
              WHEN p."handle" LIKE ${prefix} THEN 1
              WHEN lower(p."displayName") LIKE ${prefix} THEN 2
              WHEN p."handle" ILIKE ${`%${escapeLike(query)}%`} THEN 3
              WHEN p."displayName" ILIKE ${`%${escapeLike(query)}%`} THEN 4
              ELSE 5
            END ASC,
            GREATEST(
              similarity(p."handle", ${query}),
              similarity(p."displayName", ${query})
            ) DESC,
            length(p."handle") ASC,
            p."handle" ASC
          LIMIT ${USER_SEARCH_LIMIT}
        `;

  // Blocked accounts are filtered here rather than in the SQL above: both
  // branches are raw queries, and threading an id list through them buys less
  // than it costs when the result set is already capped at USER_SEARCH_LIMIT.
  const hidden = new Set(await blockedUserIds(args.userId, db));

  return {
    users: rows
      .filter((row) => !hidden.has(row.userId))
      .map((row) => ({
        id: row.userId,
        handle: row.handle,
        displayName: row.displayName,
        avatarUrl: row.avatarUrl,
      })),
  };
}

const PULSE_LATEST_COUNT = 4;
/**
 * The minimap draws the strongest connections between the nodes it shows. The
 * edges come free (getMemoryGraph already fetched them), so this cap is purely
 * about payload size and keeping the thumbnail from turning into a hairball.
 */
const PULSE_MAP_EDGES = 80;

/**
 * The pulse: for every person the viewer follows, a small version of their
 * semantic map plus their latest logs. One entry per followed user, newest
 * follows first. Reuses the same layout the person sees on their own map, so
 * the miniature is faithful to the real thing.
 */
export async function getPulse(args: { userId: string; db?: DbClient }) {
  const db = args.db ?? prisma;

  // Belt and braces: blockUser already deletes the follow edges, but a block
  // written by any other path must still take effect on the very next read.
  const hidden = await blockedUserIds(args.userId, db);

  const follows = await db.follow.findMany({
    where: {
      followerId: args.userId,
      ...(hidden.length > 0 ? { followingId: { notIn: hidden } } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: {
      following: {
        select: {
          id: true,
          profile: {
            select: {
              handle: true,
              displayName: true,
              avatarUrl: true,
              identitySummary: true,
            },
          },
        },
      },
    },
  });

  const friends = await Promise.all(
    follows.map(async ({ following: user }) => {
      const graph = await getMemoryGraph({ userId: user.id, limit: PULSE_MAP_NODES, db });

      // Nodes arrive newest-first, so the head of the list is the latest logs.
      const latest = graph.nodes.slice(0, PULSE_LATEST_COUNT).map((node) => ({
        id: node.id,
        title: node.label,
        keyIdea: node.keyIdea,
        kind: node.kind,
        capturedAt: node.capturedAt.toISOString(),
        topics: node.topics,
      }));

      return {
        user: {
          id: user.id,
          handle: user.profile?.handle ?? user.id,
          displayName: user.profile?.displayName ?? "Unknown",
          avatarUrl: user.profile?.avatarUrl ?? null,
          identitySummary: user.profile?.identitySummary ?? null,
        },
        // Their true capture total, not `nodes.length` — the node list is capped
        // at PULSE_MAP_NODES, so counting it would quietly under-report a
        // prolific person's map as exactly 60 points forever.
        captureCount: graph.totalCount,
        map: {
          nodes: graph.nodes.map((node) => ({
            id: node.id,
            x: node.x,
            y: node.y,
            kind: node.kind,
            topics: node.topics,
          })),
          edges: [...graph.edges]
            .sort((a, b) => b.weight - a.weight)
            .slice(0, PULSE_MAP_EDGES)
            .map((edge) => ({
              from: edge.fromItemId,
              to: edge.toItemId,
              type: edge.type,
              weight: edge.weight,
            })),
          clusters: graph.clusters.map((cluster) => ({
            topicId: cluster.topicId,
            name: cluster.name,
            kind: cluster.kind,
            count: cluster.count,
          })),
        },
        latest,
      };
    }),
  );

  return { friends };
}

const PERSON_CAPTURES_PAGE = 40;

/** "fs.blog", not "https://www.fs.blog/x" — a source name, not a link. */
function sourceHost(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * A followed person's capture history for their detail page. Followers-only:
 * the page exists only along a live follow edge, and a block severs it in both
 * directions — every failure is the same non-committal 404, for the same
 * reason followUser's block message stays vague.
 *
 * Words-only rule, tightened: only content metadata (title, author, source)
 * crosses the wire. Nothing the pipeline or the owner wrote about the content
 * (keyIdea, summary, reaction, userContext) does.
 */
/**
 * Everything under /api/social/users/[id] is followers-only, and a block in
 * either direction hides the person entirely. Both cases answer the same 404 so
 * the response never says which one it was.
 */
async function assertCanViewPerson(userId: string, targetUserId: string, db: DbClient) {
  const hidden = await blockedUserIds(userId, db);
  const follow = hidden.includes(targetUserId)
    ? null
    : await db.follow.findUnique({
        where: {
          followerId_followingId: {
            followerId: userId,
            followingId: targetUserId,
          },
        },
      });
  if (!follow) {
    throw new AppError("PERSON_NOT_FOUND", "Person not found", 404);
  }
}

export async function getPersonCaptures(args: {
  userId: string;
  targetUserId: string;
  cursor?: string;
  db?: DbClient;
}) {
  const db = args.db ?? prisma;

  await assertCanViewPerson(args.userId, args.targetUserId, db);

  const target = await db.user.findUnique({
    where: { id: args.targetUserId },
    select: {
      id: true,
      profile: {
        select: {
          handle: true,
          displayName: true,
          avatarUrl: true,
          identitySummary: true,
        },
      },
    },
  });
  if (!target) {
    throw new AppError("PERSON_NOT_FOUND", "Person not found", 404);
  }

  const [captureCount, followerCount, followingCount, rows] = await Promise.all([
    db.capturedItem.count({ where: { userId: args.targetUserId } }),
    db.follow.count({ where: { followingId: args.targetUserId } }),
    db.follow.count({ where: { followerId: args.targetUserId } }),
    db.capturedItem.findMany({
      where: { userId: args.targetUserId },
      orderBy: [{ capturedAt: "desc" }, { id: "desc" }],
      take: PERSON_CAPTURES_PAGE + 1,
      ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        kind: true,
        capturedAt: true,
        userTitle: true,
        rawText: true,
        caption: true,
        contentItem: {
          select: {
            title: true,
            authorName: true,
            siteName: true,
            canonicalUrl: true,
          },
        },
      },
    }),
  ]);

  const page = rows.slice(0, PERSON_CAPTURES_PAGE);
  const captures = page.map((row) => ({
    id: row.id,
    title: nodeLabel({
      userTitle: row.userTitle,
      contentTitle: row.contentItem?.title ?? null,
      rawText: row.rawText,
      caption: row.caption,
      kind: row.kind,
    }),
    kind: row.kind,
    capturedAt: row.capturedAt.toISOString(),
    author: row.contentItem?.authorName ?? null,
    source: row.contentItem?.siteName ?? sourceHost(row.contentItem?.canonicalUrl ?? null),
  }));

  return {
    user: {
      id: target.id,
      handle: target.profile?.handle ?? target.id,
      displayName: target.profile?.displayName ?? "Unknown",
      avatarUrl: target.profile?.avatarUrl ?? null,
      identitySummary: target.profile?.identitySummary ?? null,
    },
    captureCount,
    followerCount,
    followingCount,
    captures,
    nextCursor: rows.length > PERSON_CAPTURES_PAGE ? page[page.length - 1]!.id : null,
  };
}

const PERSON_FOLLOWS_PAGE = 50;

/**
 * Who a followed person follows, or who follows them, so the viewer can find
 * people through people. Each row says whether the viewer already follows that
 * account (person pages are followers-only, so that decides whether a tap can
 * open one). Anyone blocked in either direction with the VIEWER is left out.
 */
export async function getPersonFollows(args: {
  userId: string;
  targetUserId: string;
  list: "followers" | "following";
  cursor?: string;
  db?: DbClient;
}) {
  const db = args.db ?? prisma;

  await assertCanViewPerson(args.userId, args.targetUserId, db);

  const hidden = await blockedUserIds(args.userId, db);
  const profileSelect = {
    id: true,
    profile: { select: { handle: true, displayName: true, avatarUrl: true } },
  } as const;
  const rows = await db.follow.findMany({
    where:
      args.list === "followers"
        ? { followingId: args.targetUserId, followerId: { notIn: hidden } }
        : { followerId: args.targetUserId, followingId: { notIn: hidden } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PERSON_FOLLOWS_PAGE + 1,
    ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      follower: { select: profileSelect },
      following: { select: profileSelect },
    },
  });

  const page = rows.slice(0, PERSON_FOLLOWS_PAGE);
  const people = page.map((row) => (args.list === "followers" ? row.follower : row.following));
  const followed = new Set(
    (
      await db.follow.findMany({
        where: { followerId: args.userId, followingId: { in: people.map((p) => p.id) } },
        select: { followingId: true },
      })
    ).map((row) => row.followingId),
  );

  return {
    users: people.map((person) => ({
      id: person.id,
      handle: person.profile?.handle ?? person.id,
      displayName: person.profile?.displayName ?? "Unknown",
      avatarUrl: person.profile?.avatarUrl ?? null,
      isViewer: person.id === args.userId,
      viewerFollows: followed.has(person.id),
    })),
    nextCursor: rows.length > PERSON_FOLLOWS_PAGE ? page[page.length - 1]!.id : null,
  };
}

/** Longer than this, a description is a scraped body, not an excerpt. */
const PERSON_EXCERPT_MAX = 400;

/**
 * One of a followed person's captures, opened from their profile.
 *
 * Content only, the same words-only rule as the list: what the thing IS (cover,
 * title, author, source, link, the source's own excerpt, the topics it sits in)
 * and never what the person or the pipeline made of it — keyIdea, summary,
 * reaction, userContext and insights stay with the owner. A typed note's full
 * text is the owner's thinking, so only quotes (someone else's words) carry
 * their body; a note shows the title the list already showed.
 */
export async function getPersonCapture(args: {
  userId: string;
  targetUserId: string;
  captureId: string;
  db?: DbClient;
}) {
  const db = args.db ?? prisma;

  await assertCanViewPerson(args.userId, args.targetUserId, db);

  const row = await db.capturedItem.findUnique({
    where: { id: args.captureId },
    select: {
      id: true,
      userId: true,
      kind: true,
      capturedAt: true,
      userTitle: true,
      rawText: true,
      caption: true,
      mediaUrl: true,
      contentItem: {
        select: {
          title: true,
          description: true,
          authorName: true,
          siteName: true,
          canonicalUrl: true,
          imageUrl: true,
        },
      },
      topics: {
        orderBy: { weight: "desc" },
        select: { topic: { select: { id: true, name: true } } },
      },
    },
  });
  // Someone else's capture id under this person's URL is the same "not found".
  if (!row || row.userId !== args.targetUserId) {
    throw new AppError("CAPTURE_NOT_FOUND", "Capture not found", 404);
  }

  const description = row.contentItem?.description?.trim() ?? "";
  const excerpt =
    (row.kind === "LINK" || row.kind === "IMAGE") &&
    description.length > 0 &&
    description.length <= PERSON_EXCERPT_MAX &&
    !/^https?:\/\//i.test(description)
      ? description
      : null;

  return {
    id: row.id,
    kind: row.kind,
    title: nodeLabel({
      userTitle: row.userTitle,
      contentTitle: row.contentItem?.title ?? null,
      rawText: row.rawText,
      caption: row.caption,
      kind: row.kind,
    }),
    capturedAt: row.capturedAt.toISOString(),
    author: row.contentItem?.authorName ?? null,
    source: row.contentItem?.siteName ?? sourceHost(row.contentItem?.canonicalUrl ?? null),
    url: row.contentItem?.canonicalUrl ?? null,
    imageUrl: row.contentItem?.imageUrl ?? (row.kind === "IMAGE" ? row.mediaUrl : null),
    excerpt,
    quote: row.kind === "QUOTE" ? row.rawText?.trim() || null : null,
    topics: row.topics.map(({ topic }) => ({
      id: topic.id,
      name: topic.name,
      kind: isGeneralTopic(topic.name) ? ("general" as const) : ("specific" as const),
    })),
  };
}

const OVERLAP_TOPICS = 6;
const OVERLAP_SAVES = 3;

/**
 * A followed person's "wrapped" portrait — only the cards that say who someone
 * is (the fields they live in, what they dig into, where they've just gone,
 * when they save, what they save) — plus where it overlaps with the viewer.
 * Counts and streaks stay on the owner's own page.
 *
 * The rhythm is bucketed on the PERSON's clock (their last-seen offset), so
 * "around 1am" means 1am where they are, not where the viewer is.
 */
export async function getPersonWrapped(args: {
  userId: string;
  targetUserId: string;
  db?: DbClient;
}) {
  const db = args.db ?? prisma;

  await assertCanViewPerson(args.userId, args.targetUserId, db);

  const prefs = await db.userPreference.findUnique({
    where: { userId: args.targetUserId },
    select: { tzOffsetMinutes: true },
  });
  const stats = await getCaptureWrappedStats(
    args.targetUserId,
    { tzOffsetMinutes: prefs?.tzOffsetMinutes ?? 0 },
    db,
  );

  const [theirTopics, myTopics, theirContent, myContent] = await Promise.all([
    topicTally(args.targetUserId, db),
    topicTally(args.userId, db),
    db.capturedItem.findMany({
      where: { userId: args.targetUserId, contentItemId: { not: null } },
      orderBy: { capturedAt: "desc" },
      select: {
        id: true,
        contentItemId: true,
        userTitle: true,
        rawText: true,
        caption: true,
        kind: true,
        contentItem: { select: { title: true } },
      },
    }),
    db.capturedItem.findMany({
      where: { userId: args.userId, contentItemId: { not: null } },
      select: { contentItemId: true },
    }),
  ]);

  // Ranked by the smaller side's count: a topic you've each saved five times is
  // more shared ground than one they've saved forty times and you once.
  const sharedTopics = [...theirTopics.entries()]
    .filter(([name]) => myTopics.has(name))
    .map(([name, theirs]) => ({
      name,
      general: isGeneralTopic(name),
      weight: Math.min(theirs, myTopics.get(name)!),
    }))
    // Specific sub-topics say more than "both of you save philosophy".
    .sort((a, b) => Number(a.general) - Number(b.general) || b.weight - a.weight)
    .slice(0, OVERLAP_TOPICS)
    .map((entry) => entry.name);

  const mine = new Set(myContent.map((row) => row.contentItemId));
  const seen = new Set<string>();
  const sharedSaves: { id: string; title: string }[] = [];
  let sharedSaveCount = 0;
  for (const row of theirContent) {
    if (!row.contentItemId || !mine.has(row.contentItemId) || seen.has(row.contentItemId)) continue;
    seen.add(row.contentItemId);
    sharedSaveCount += 1;
    if (sharedSaves.length < OVERLAP_SAVES) {
      sharedSaves.push({
        id: row.id,
        title: nodeLabel({
          userTitle: row.userTitle,
          contentTitle: row.contentItem?.title ?? null,
          rawText: row.rawText,
          caption: row.caption,
          kind: row.kind,
        }),
      });
    }
  }

  return {
    totalCaptures: stats.totalCaptures,
    topFields: stats.topFields,
    topTopics: stats.topTopics,
    recentNewTopics: stats.recentNewTopics,
    busiestHour: stats.busiestHour,
    hourHistogram: stats.hourHistogram,
    formats: stats.formats,
    overlap: { topics: sharedTopics, saves: sharedSaves, saveCount: sharedSaveCount },
  };
}

/** How many of a user's captures sit in each topic, by topic name. */
async function topicTally(userId: string, db: DbClient): Promise<Map<string, number>> {
  const rows = await db.capturedItemTopic.findMany({
    where: { capturedItem: { userId } },
    select: { topic: { select: { name: true } } },
  });
  const tally = new Map<string, number>();
  for (const row of rows) {
    tally.set(row.topic.name, (tally.get(row.topic.name) ?? 0) + 1);
  }
  return tally;
}

export async function commentOnReview(args: {
  userId: string;
  reviewId: string;
  parentId?: string;
  content: string;
  visibility: Visibility;
  db?: DbClient;
}) {
  const db = args.db ?? prisma;
  const review = await db.review.findUnique({
    where: { id: args.reviewId },
    include: {
      logEntry: true,
    },
  });

  if (!review || review.visibility === Visibility.PRIVATE) {
    throw new AppError("REVIEW_NOT_FOUND", "Review not found", 404);
  }

  if (args.parentId) {
    const parent = await db.comment.findUnique({
      where: { id: args.parentId },
    });

    if (!parent || parent.reviewId !== args.reviewId) {
      throw new AppError("INVALID_PARENT", "Reply target is invalid", 400);
    }
  }

  const comment = await db.comment.create({
    data: {
      authorId: args.userId,
      reviewId: args.reviewId,
      parentId: args.parentId,
      content: args.content,
      visibility: args.visibility,
    },
  });

  await recordActivityEvent({
    db,
    actorId: args.userId,
    contentItemId: review.logEntry.contentItemId,
    reviewId: args.reviewId,
    commentId: comment.id,
    type: ActivityType.COMMENTED,
    weight: 1,
    visibility: args.visibility,
  });

  const notificationType = args.parentId ? NotificationType.NEW_REPLY : NotificationType.NEW_COMMENT;
  const recipientId = args.parentId
    ? (await db.comment.findUnique({ where: { id: args.parentId }, select: { authorId: true } }))?.authorId
    : review.authorId;

  if (recipientId && recipientId !== args.userId) {
    await createNotification({
      db,
      recipientId,
      actorId: args.userId,
      type: notificationType,
      deepLink: `/content/${review.logEntry.contentItemId}`,
      payload: { reviewId: args.reviewId, commentId: comment.id },
    });
  }

  return {
    comment,
  };
}
