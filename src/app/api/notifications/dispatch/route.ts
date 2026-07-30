import { handleRoute } from "@/lib/api";
import { requireSharedSecret } from "@/lib/auth";
import { dispatchPendingNotifications } from "@/server/services/notifications";

/**
 * Drain every PENDING notification through Expo's push service.
 *
 * Machine-to-machine, gated on NOTIFICATIONS_DISPATCH_SECRET — there is no user
 * session here because the whole point is to send other people's pushes.
 *
 *   curl -X POST https://mneme-backend.onrender.com/api/notifications/dispatch \
 *     -H "Authorization: Bearer $NOTIFICATIONS_DISPATCH_SECRET"
 *
 * Safe to call as often as you like: a drain with nothing pending is two cheap
 * queries and no outbound request. Nothing schedules this yet — it is deliberately
 * a pipe you pull, so the cadence stays a decision rather than a cron bill.
 */
export const dynamic = "force-dynamic";

/** Ceiling per call, so one drain can't run unbounded on a small instance. */
const DISPATCH_LIMIT = 500;

export async function POST(request: Request) {
  return handleRoute(async () => {
    requireSharedSecret(request, "NOTIFICATIONS_DISPATCH_SECRET");
    return dispatchPendingNotifications({ limit: DISPATCH_LIMIT });
  });
}
