import { AppError, handleRoute } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { SESSION_TARGETS } from "@/server/connections/session";

export const dynamic = "force-dynamic";

/** The in-app sign-in recipe for one target: where to open, when it's ready, what to run. */
export async function GET(request: Request, { params }: { params: { target: string } }) {
  return handleRoute(async () => {
    await requireRequestUserId(request);
    const target = SESSION_TARGETS.find((t) => t.key === params.target);
    if (!target) throw new AppError("NOT_FOUND", "mneme can't sign in there yet.", 404);
    return target;
  });
}
