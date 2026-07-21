import { handleRoute, parseSearchParams } from "@/lib/api";
import { searchSchema } from "@/server/contracts";
import { enforceRateLimit, knownClientIp } from "@/server/services/ratelimit";
import { searchEverything } from "@/server/services/search";

// Deliberately still unauthenticated — this backs public discovery — so it is
// limited by source address rather than by user. If no proxy header identifies
// an address we skip the limit rather than put every caller in one bucket; see
// knownClientIp.
export async function GET(request: Request) {
  return handleRoute(async () => {
    const ip = knownClientIp(request);
    if (ip) enforceRateLimit(ip, "search", 60, 60_000);
    const input = await parseSearchParams(request, searchSchema);
    return searchEverything({
      query: input.query,
      limit: input.limit,
    });
  });
}
