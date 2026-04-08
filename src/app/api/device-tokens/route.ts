import { handleRoute, parseJson } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { registerDeviceTokenSchema } from "@/server/contracts";
import { registerDeviceToken } from "@/server/services/notifications";

export async function POST(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    const input = await parseJson(request, registerDeviceTokenSchema);
    return registerDeviceToken({
      userId,
      token: input.token,
      platform: input.platform,
      provider: input.provider,
    });
  }, 201);
}
