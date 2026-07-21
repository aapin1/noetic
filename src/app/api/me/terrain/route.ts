import { handleRoute } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { enforceRateLimit } from "@/server/services/ratelimit";
import { getTerrain } from "@/server/services/terrain";

export async function GET(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    // A cache miss here reads the user's whole capture history; the limit keeps
    // a client that retries in a loop from recomputing it over and over.
    enforceRateLimit(userId, "terrain", 30, 5 * 60_000);
    const raw = new URL(request.url).searchParams.get("tzOffsetMinutes");
    const tzOffsetMinutes = raw === null ? 0 : Number(raw);
    return getTerrain(userId, { tzOffsetMinutes });
  });
}
