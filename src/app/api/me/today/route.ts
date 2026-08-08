import { handleRoute } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { rememberTzOffset } from "@/server/services/streak";
import { getToday } from "@/server/services/today";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    const raw = new URL(request.url).searchParams.get("tzOffsetMinutes");
    const tzOffsetMinutes = raw === null ? 0 : Number(raw);
    void rememberTzOffset(userId, raw === null ? null : tzOffsetMinutes);
    return getToday({ userId, tzOffsetMinutes });
  });
}
