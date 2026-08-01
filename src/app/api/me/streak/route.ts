import { handleRoute } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { getStreakSummary, rememberTzOffset } from "@/server/services/streak";

/**
 * The streak, small enough to ride along with every app open.
 *
 * It exists because the number was previously reachable only inside the wrapped
 * run on the profile tab: a user who never opened that tab could not see a
 * streak, and so could not act on one. Home now shows it, and this is what home
 * reads.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    const raw = new URL(request.url).searchParams.get("tzOffsetMinutes");
    const tzOffsetMinutes = raw === null ? 0 : Number(raw);

    // Cheap second source for the clock, behind the capture path. Not awaited:
    // the summary below does not depend on it, and the offset it records is for
    // the next sweep, not for this response.
    void rememberTzOffset(userId, raw === null ? null : tzOffsetMinutes);

    return getStreakSummary({ userId, tzOffsetMinutes });
  });
}
