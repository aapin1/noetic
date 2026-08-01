import { handleRoute } from "@/lib/api";
import { requireSharedSecret } from "@/lib/auth";
import { runNotificationJob } from "@/server/services/notification-job";

/**
 * The hourly notification job, as an endpoint. All of it lives in
 * services/notification-job.ts; this is the shared-secret gate and nothing else.
 *
 * Same secret as the plain drain — this is strictly more powerful, so it gets no
 * weaker a gate.
 *
 *   curl -X POST https://mneme-backend.onrender.com/api/notifications/resurface \
 *     -H "Authorization: Bearer $NOTIFICATIONS_DISPATCH_SECRET"
 *
 * Safe to call as often as you like. The sweeps select each user once a day, at
 * their own local send hour, and a lease keeps two overlapping runs from both
 * draining the queue — so a second call inside the hour queues nothing and sends
 * nothing.
 *
 * The path still says "resurface" because that is what render.yaml's cron and
 * the runbook curl already point at. It has run the streak guard too since the
 * guard shipped, and the whole hourly job since scheduling did.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleRoute(async () => {
    requireSharedSecret(request, "NOTIFICATIONS_DISPATCH_SECRET");
    return runNotificationJob();
  });
}
