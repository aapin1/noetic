import { AppError, handleRoute, parseJson } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { sendNotificationPayloadsSchema } from "@/server/contracts";
import { prepareNotificationPayloads } from "@/server/services/notifications";

export async function POST(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    const input = await parseJson(request, sendNotificationPayloadsSchema);

    if (input.recipientId && input.recipientId !== userId) {
      throw new AppError("FORBIDDEN", "You can only request notification payloads for yourself", 403);
    }

    return prepareNotificationPayloads({
      notificationIds: input.notificationIds,
      recipientId: input.recipientId ?? userId,
    });
  });
}
