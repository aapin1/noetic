import { handleRoute, parseJson } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { recognizeProbeSchema } from "@/server/contracts";
import { enforceRateLimit } from "@/server/services/ratelimit";
import { probeCapture } from "@/server/services/recognize";

export async function POST(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    enforceRateLimit(userId, "recognize-probe", 30, 5 * 60_000);
    const input = await parseJson(request, recognizeProbeSchema);
    // Empty list = strong enough to stand on its own (or the judge was
    // unavailable) — the client commits without asking anything.
    return { questions: await probeCapture(input) };
  });
}
