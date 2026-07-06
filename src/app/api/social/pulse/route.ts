import { handleRoute } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { getPulse } from "@/server/services/social";

export async function GET(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    return getPulse({ userId });
  });
}
