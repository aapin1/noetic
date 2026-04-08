import type { Prisma } from "@prisma/client";
import { Visibility } from "@prisma/client";
import type { DbClient } from "@/server/db";

export async function viewerFollowsUser(db: DbClient, viewerId: string | null | undefined, ownerId: string) {
  if (!viewerId || viewerId === ownerId) {
    return false;
  }

  const follow = await db.follow.findUnique({
    where: {
      followerId_followingId: {
        followerId: viewerId,
        followingId: ownerId,
      },
    },
    select: { id: true },
  });

  return Boolean(follow);
}

export async function visibleActivityWhere(db: DbClient, viewerId: string | null | undefined, ownerId: string): Promise<Prisma.ActivityEventWhereInput> {
  if (viewerId && viewerId === ownerId) {
    return { actorId: ownerId };
  }

  const follows = await viewerFollowsUser(db, viewerId, ownerId);

  if (follows) {
    return {
      actorId: ownerId,
      visibility: {
        in: [Visibility.PUBLIC, Visibility.FOLLOWERS],
      },
    };
  }

  return {
    actorId: ownerId,
    visibility: Visibility.PUBLIC,
  };
}

export async function visibleLogWhere(db: DbClient, viewerId: string | null | undefined, ownerId: string): Promise<Prisma.LogEntryWhereInput> {
  if (viewerId && viewerId === ownerId) {
    return { userId: ownerId };
  }

  const follows = await viewerFollowsUser(db, viewerId, ownerId);

  if (follows) {
    return {
      userId: ownerId,
      visibility: {
        in: [Visibility.PUBLIC, Visibility.FOLLOWERS],
      },
    };
  }

  return {
    userId: ownerId,
    visibility: Visibility.PUBLIC,
  };
}

export async function visibleReviewWhere(db: DbClient, viewerId: string | null | undefined, ownerId: string): Promise<Prisma.ReviewWhereInput> {
  if (viewerId && viewerId === ownerId) {
    return { authorId: ownerId };
  }

  const follows = await viewerFollowsUser(db, viewerId, ownerId);

  if (follows) {
    return {
      authorId: ownerId,
      visibility: {
        in: [Visibility.PUBLIC, Visibility.FOLLOWERS],
      },
    };
  }

  return {
    authorId: ownerId,
    visibility: Visibility.PUBLIC,
  };
}

export async function visibleRankingWhere(db: DbClient, viewerId: string | null | undefined, ownerId: string): Promise<Prisma.RankingListWhereInput> {
  if (viewerId && viewerId === ownerId) {
    return { userId: ownerId };
  }

  const follows = await viewerFollowsUser(db, viewerId, ownerId);

  if (follows) {
    return {
      userId: ownerId,
      visibility: {
        in: [Visibility.PUBLIC, Visibility.FOLLOWERS],
      },
    };
  }

  return {
    userId: ownerId,
    visibility: Visibility.PUBLIC,
  };
}
