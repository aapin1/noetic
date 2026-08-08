import { handleRoute, parseJson } from "@/lib/api";
import { passwordResetRequestSchema } from "@/server/contracts";
import { requestPasswordReset } from "@/server/services/password-reset";
import { clientIp, enforceDurableRateLimit } from "@/server/services/ratelimit";

// Every request costs us a bcrypt hash and an email, and every email is a
// nuisance to whoever owns the address — so ALL attempts count, successful or
// not. Two keys: the per-email limit stops one address being bombarded (and
// bounds code-rotation games), the per-IP limit stops one client spraying many
// addresses. Both are keyed on the submitted string, so behavior is identical
// whether or not an account exists — the limiter cannot become the
// enumeration oracle the response shape avoids being.
const WINDOW_MS = 15 * 60_000;
const EMAIL_LIMIT = 3;
const IP_LIMIT = 10;

export async function POST(request: Request) {
  return handleRoute(async () => {
    const input = await parseJson(request, passwordResetRequestSchema);
    const email = input.email.trim().toLowerCase();

    await enforceDurableRateLimit(`pw_reset_req:ip:${clientIp(request)}`, IP_LIMIT, WINDOW_MS);
    await enforceDurableRateLimit(`pw_reset_req:email:${email}`, EMAIL_LIMIT, WINDOW_MS);

    return requestPasswordReset({ email });
  });
}
