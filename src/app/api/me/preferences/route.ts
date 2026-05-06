import { Prisma } from "@prisma/client";
import { handleRoute, parseJson } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { updatePreferencesSchema } from "@/server/contracts";
import { getPreferences, updatePreferences } from "@/server/services/preferences";

export async function GET(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    return getPreferences({ userId });
  });
}

export async function PATCH(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    const input = await parseJson(request, updatePreferencesSchema);
    return updatePreferences({
      userId,
      insightStyle: input.insightStyle,
      preferences: input.preferences as Prisma.InputJsonValue | undefined,
    });
  });
}
