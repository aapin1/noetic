import { handleRoute, parseSearchParams } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { getFeedSchema } from "@/server/contracts";
import { getFeed } from "@/server/services/feed";

export async function GET(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    const input = await parseSearchParams(request, getFeedSchema);
    return getFeed({
      userId,
      sort: input.sort,
      limit: input.limit,
    });
  });
}
