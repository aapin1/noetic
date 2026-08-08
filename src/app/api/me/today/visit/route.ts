import { z } from "zod";
import { handleRoute, parseJson } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { getStreakSummary, recordReviewActivity, rememberTzOffset } from "@/server/services/streak";

export const dynamic = "force-dynamic";

const visitSchema = z.object({
  tzOffsetMinutes: z.number().int().min(-840).max(840).optional(),
});

/** Opening /today counts as streak activity for the local day. Idempotent —
 * a second visit the same day credits nothing and just returns the summary. */
export async function POST(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    const input = await parseJson(request, visitSchema);
    void rememberTzOffset(userId, input.tzOffsetMinutes);
    const { credited } = await recordReviewActivity({
      userId,
      tzOffsetMinutes: input.tzOffsetMinutes,
    });
    const streak = await getStreakSummary({ userId, tzOffsetMinutes: input.tzOffsetMinutes });
    return { credited, streak };
  });
}
