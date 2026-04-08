import { Visibility } from "@prisma/client";

export function canViewerSeeVisibility(args: {
  visibility: Visibility;
  viewerId?: string | null;
  ownerId: string;
  viewerFollowsOwner?: boolean;
}) {
  const { visibility, viewerId, ownerId, viewerFollowsOwner = false } = args;

  if (viewerId && viewerId === ownerId) {
    return true;
  }

  if (visibility === Visibility.PUBLIC) {
    return true;
  }

  if (visibility === Visibility.FOLLOWERS) {
    return viewerFollowsOwner;
  }

  return false;
}
