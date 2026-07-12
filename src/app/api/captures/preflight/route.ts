import { handleRoute, parseJson } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { capturePreflightSchema } from "@/server/contracts";
import { preflightUrl } from "@/server/services/content";
import { isPaidTranscriptHost } from "@/server/metadata";
import { hasUsageRemaining } from "@/server/services/usage";

export async function POST(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    const input = await parseJson(request, capturePreflightSchema);
    // Peek, never consume: quota is only burned by the capture itself, but the
    // preflight ingest must not spend Supadata credits for an over-cap user.
    const allowPaidTranscript =
      !isPaidTranscriptHost(input.url) ||
      (await hasUsageRemaining(userId, "social_video_transcript"));
    return preflightUrl(input.url, undefined, { allowPaidTranscript });
  });
}
