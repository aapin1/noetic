import { handleRoute } from "@/lib/api";
import { requireSharedSecret } from "@/lib/auth";
import { dispatchPendingNotifications } from "@/server/services/notifications";
import { runResurfaceSweep } from "@/server/services/resurface";

/**
 * The daily job: pick one thing worth saying to each reachable user, queue it,
 * then push everything pending.
 *
 * Same shared secret as the plain drain — this is strictly more powerful, so it
 * gets no weaker a gate.
 *
 *   curl -X POST https://mneme-backend.onrender.com/api/notifications/resurface \
 *     -H "Authorization: Bearer $NOTIFICATIONS_DISPATCH_SECRET"
 *
 * Idempotent within a day: selection enforces its own one-per-user-per-day cap,
 * so calling this twice in an afternoon queues nothing the second time. Nothing
 * schedules it; run it when you want the day's pushes to go out.
 */
export const dynamic = "force-dynamic";

const DISPATCH_LIMIT = 500;

export async function POST(request: Request) {
  return handleRoute(async () => {
    requireSharedSecret(request, "NOTIFICATIONS_DISPATCH_SECRET");

    const sweep = await runResurfaceSweep();
    const dispatch = await dispatchPendingNotifications({ limit: DISPATCH_LIMIT });

    return { sweep, dispatch };
  });
}
