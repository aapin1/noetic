import { handleRoute } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { getPersonalIntelligence } from "@/server/services/intelligence";
import { enforceRateLimit } from "@/server/services/ratelimit";

export async function GET(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    // On a cache miss this is an LLM synthesis over a 200-capture scan.
    enforceRateLimit(userId, "intelligence", 30, 5 * 60_000);
    return getPersonalIntelligence({ userId });
  });
}
