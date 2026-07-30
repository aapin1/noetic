import { AppError, handleRoute, parseJson } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { sendNotificationPayloadsSchema } from "@/server/contracts";
import { dispatchPendingNotifications } from "@/server/services/notifications";

/**
 * Send the caller's own pending notifications now — the "test push" path from a
 * signed-in device.
 *
 * This used to hand the client a list of payloads and mark them SENT, which
 * only made sense if the client were going to transmit them (it can't). It now
 * does the sending, scoped to the caller. The bulk drain lives behind a shared
 * secret at /api/notifications/dispatch.
 */
export async function POST(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    const input = await parseJson(request, sendNotificationPayloadsSchema);

    if (input.recipientId && input.recipientId !== userId) {
      throw new AppError("FORBIDDEN", "You can only send notifications to yourself", 403);
    }

    return dispatchPendingNotifications({
      notificationIds: input.notificationIds,
      recipientId: input.recipientId ?? userId,
    });
  });
}
