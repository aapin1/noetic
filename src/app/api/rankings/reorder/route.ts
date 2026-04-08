import { handleRoute, parseJson } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { reorderRankingSchema } from "@/server/contracts";
import { reorderRankingItems } from "@/server/services/rankings";

export async function POST(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    const input = await parseJson(request, reorderRankingSchema);
    return reorderRankingItems({
      userId,
      rankingListId: input.rankingListId,
      contentItemIds: input.contentItemIds,
    });
  });
}
