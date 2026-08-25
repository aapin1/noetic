import { handleRoute, parseJson } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { capturePreflightSchema } from "@/server/contracts";
import { preflightUrl } from "@/server/services/content";
import { isPaidTranscriptHost } from "@/server/metadata";
import { enforceRateLimit } from "@/server/services/ratelimit";
import { hasUsageRemaining, tryConsumeUsage, usageLimitNoticeFor } from "@/server/services/usage";

export async function POST(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    enforceRateLimit(userId, "preflight", 60, 5 * 60_000);
    const input = await parseJson(request, capturePreflightSchema);
    // Peek first so an over-cap user never spends a Supadata credit; meter
    // only when the preflight's ingest actually used the paid backstop (the
    // capture that follows reuses this row, so this is its one billing point).
    const social = isPaidTranscriptHost(input.url);
    const allowPaidTranscript = !social || (await hasUsageRemaining(userId, "social_video_transcript"));
    const result = await preflightUrl(input.url, undefined, { allowPaidTranscript });
    if (social && result.usedSupadata) {
      await tryConsumeUsage(userId, "social_video_transcript");
    }
    const { usedSupadata: _spent, ...response } = result;
    // Over the cap AND the free ladder came back without a transcript or a
    // vision read: tell the user on the reaction step, with the reset date.
    const degradedByCap = social && !allowPaidTranscript && result.bodySource !== "transcript" && result.bodySource !== "vision";
    return degradedByCap ? { ...response, usageLimit: await usageLimitNoticeFor(userId, "social_video_transcript") } : response;
  });
}
