import { AppError } from "@/lib/api";

export function normalizeRankingOrder(contentItemIds: string[]) {
  const deduped = new Set(contentItemIds);

  if (deduped.size !== contentItemIds.length) {
    throw new AppError("DUPLICATE_RANKED_ITEM", "Ranking lists cannot contain duplicate content items", 409);
  }

  return contentItemIds.map((contentItemId, index) => ({
    contentItemId,
    position: index + 1,
  }));
}
