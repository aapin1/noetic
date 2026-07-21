import { handleRoute, parseJson } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { ingestContentSchema } from "@/server/contracts";
import { ingestUrl } from "@/server/services/content";
import { enforceRateLimit } from "@/server/services/ratelimit";

// This route makes the server fetch a URL of the caller's choosing and runs the
// full extraction ladder (which can spend paid Supadata credits). Anonymous
// access to that is an open scraping proxy billed to us, so it now requires a
// signed-in user — the mobile client has always sent its token here.
export async function POST(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    enforceRateLimit(userId, "ingest", 60, 5 * 60_000);
    const input = await parseJson(request, ingestContentSchema);
    return ingestUrl(input.url);
  });
}
