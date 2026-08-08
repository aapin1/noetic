import { handleRoute, parseJson } from "@/lib/api";
import { appleAuthSchema } from "@/server/contracts";
import { signInWithApple, verifyAppleIdentityToken } from "@/server/services/apple";
import { clientIp, enforceDurableRateLimit } from "@/server/services/ratelimit";

// Verification is a cheap RS256 check (no bcrypt), but the endpoint is
// unauthenticated and can create accounts, so it gets the durable limiter like
// the other auth routes. Every attempt counts: a rejected token costs us
// little, but unbounded account creation is the same spam problem register has.
const WINDOW_MS = 15 * 60_000;
const IP_LIMIT = 20;

export async function POST(request: Request) {
  return handleRoute(async () => {
    await enforceDurableRateLimit(`auth_apple:ip:${clientIp(request)}`, IP_LIMIT, WINDOW_MS);
    const input = await parseJson(request, appleAuthSchema);
    const identity = await verifyAppleIdentityToken(input.identityToken);
    return signInWithApple({ identity, fullName: input.fullName });
  });
}
