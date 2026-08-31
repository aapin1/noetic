import { handleRoute, parseJson } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { recognizePreviewSchema } from "@/server/contracts";
import { resolveWork } from "@/server/imports/resolve";
import { enforceRateLimit } from "@/server/services/ratelimit";

export async function POST(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    enforceRateLimit(userId, "recognize-preview", 30, 5 * 60_000);
    const input = await parseJson(request, recognizePreviewSchema);
    const resolved = await resolveWork({ kind: input.kind, title: input.title, year: input.year });
    // A miss is an answer, not an error: the client offers "save it anyway"
    // and the commit route captures the bare title.
    return resolved ? { hit: true as const, ...resolved } : { hit: false as const };
  });
}
