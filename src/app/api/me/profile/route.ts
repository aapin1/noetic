import { handleRoute } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { getOwnerProfile } from "@/server/services/profile";

export async function GET(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    return getOwnerProfile(userId);
  });
}
