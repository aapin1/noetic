import { handleRoute, parseJson } from "@/lib/api";
import { registerSchema } from "@/server/contracts";
import { registerUser } from "@/server/services/accounts";
import { clientIp, enforceDurableRateLimit } from "@/server/services/ratelimit";

// Registration also runs bcrypt (~250ms of blocking CPU) and creates rows, so an
// unbounded signup loop is both an account-spam and an availability problem.
// Every attempt counts here, not just failures — the thing being limited is
// account creation itself.
const WINDOW_MS = 60 * 60_000;
const IP_LIMIT = 10;

export async function POST(request: Request) {
  return handleRoute(async () => {
    await enforceDurableRateLimit(`auth_register:ip:${clientIp(request)}`, IP_LIMIT, WINDOW_MS);
    const input = await parseJson(request, registerSchema);
    return registerUser(input);
  }, 201);
}
