import { handleRoute, parseSearchParams } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { memoryTrendsSchema } from "@/server/contracts";
import { getMemoryTrends } from "@/server/services/memory";

export async function GET(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    const input = await parseSearchParams(request, memoryTrendsSchema);
    return getMemoryTrends({ userId, window: input.window });
  });
}
