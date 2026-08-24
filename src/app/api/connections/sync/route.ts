import { handleRoute } from "@/lib/api";
import { requireSharedSecret } from "@/lib/auth";
import { runConnectionsJob } from "@/server/services/connections";

export const dynamic = "force-dynamic";

/**
 * The hourly connections tick. Same shared secret as the notification cron —
 * one dashboard value, one curl image, two clocks.
 */
export async function POST(request: Request) {
  return handleRoute(async () => {
    requireSharedSecret(request, "NOTIFICATIONS_DISPATCH_SECRET");
    return runConnectionsJob();
  });
}
