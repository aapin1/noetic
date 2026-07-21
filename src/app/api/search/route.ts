import { handleRoute, parseSearchParams } from "@/lib/api";
import { searchSchema } from "@/server/contracts";
import { clientIp, enforceRateLimit } from "@/server/services/ratelimit";
import { searchEverything } from "@/server/services/search";

// Deliberately still unauthenticated — this backs public discovery — so it is
// limited by source address rather than by user.
export async function GET(request: Request) {
  return handleRoute(async () => {
    enforceRateLimit(clientIp(request), "search", 60, 60_000);
    const input = await parseSearchParams(request, searchSchema);
    return searchEverything({
      query: input.query,
      limit: input.limit,
    });
  });
}
