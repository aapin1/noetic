import { handleRoute, parseJson } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { recognizeCaptureSchema } from "@/server/contracts";
import { enforceRateLimit } from "@/server/services/ratelimit";
import { captureRecognizedWork } from "@/server/services/recognize";
import { rememberTzOffset } from "@/server/services/streak";

export async function POST(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    // Shares the capture bucket: a recognition IS a capture, just sourced from
    // memory instead of a URL, and it should not widen the burst ceiling.
    enforceRateLimit(userId, "capture", 30, 5 * 60_000);
    const input = await parseJson(request, recognizeCaptureSchema);
    void rememberTzOffset(userId, input.tzOffsetMinutes);
    const capture = await captureRecognizedWork({
      userId,
      lookup: { kind: input.kind, title: input.title, year: input.year },
      words: input.words,
      context: input.context,
    });
    // Same shape the ordinary capture POST returns, so the map lands the node
    // through the one code path it already has. No position check: this flow
    // exists for accounts too young to hold positions.
    return { ...capture, positionChallenge: null };
  }, 201);
}
