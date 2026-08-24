import { handleRoute } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { SESSION_TARGETS } from "@/server/connections/session";

export const dynamic = "force-dynamic";

/** The list, without the scripts — for the connections screen. */
export async function GET(request: Request) {
  return handleRoute(async () => {
    await requireRequestUserId(request);
    return { targets: SESSION_TARGETS.map(({ script: _s, ...t }) => t) };
  });
}
