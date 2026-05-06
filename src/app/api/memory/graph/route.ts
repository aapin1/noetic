import { handleRoute, parseSearchParams } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { memoryGraphSchema } from "@/server/contracts";
import { getMemoryGraph } from "@/server/services/memory";

export async function GET(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    const input = await parseSearchParams(request, memoryGraphSchema);
    return getMemoryGraph({ userId, limit: input.limit });
  });
}
