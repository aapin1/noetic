import { handleRoute } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { getWrappedStats } from "@/server/services/wrapped";

export async function GET(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    const raw = new URL(request.url).searchParams.get("tzOffsetMinutes");
    const tzOffsetMinutes = raw === null ? 0 : Number(raw);
    return getWrappedStats(userId, { tzOffsetMinutes });
  });
}
