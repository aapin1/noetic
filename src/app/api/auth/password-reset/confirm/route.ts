import { handleRoute, parseJson } from "@/lib/api";
import { passwordResetConfirmSchema } from "@/server/contracts";
import { confirmPasswordReset } from "@/server/services/password-reset";
import { clientIp, enforceDurableRateLimit } from "@/server/services/ratelimit";

// The strong guard lives in the service: a code dies after 5 attempts, no
// matter where they come from. This IP limit is the outer wall — it stops one
// client from grinding codes across MANY accounts, and it charges every
// attempt because a legitimate user confirms once, maybe twice.
const WINDOW_MS = 15 * 60_000;
const IP_LIMIT = 20;

export async function POST(request: Request) {
  return handleRoute(async () => {
    await enforceDurableRateLimit(`pw_reset_confirm:ip:${clientIp(request)}`, IP_LIMIT, WINDOW_MS);
    const input = await parseJson(request, passwordResetConfirmSchema);
    return confirmPasswordReset(input);
  });
}
