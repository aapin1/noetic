import { handleRoute, parseJson } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { upsertRankingSchema } from "@/server/contracts";
import { upsertRankingList } from "@/server/services/rankings";

export async function POST(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    const input = await parseJson(request, upsertRankingSchema);
    const visibility = input.visibility ?? "PUBLIC";
    return upsertRankingList({
      userId,
      rankingListId: input.rankingListId,
      title: input.title,
      description: input.description,
      visibility,
      items: input.items,
    });
  });
}
