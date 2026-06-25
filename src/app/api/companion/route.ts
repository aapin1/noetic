import { handleRoute } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { getOrCreateCompanionThread } from "@/server/services/companion";

export async function GET(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    return getOrCreateCompanionThread({ userId });
  });
}
