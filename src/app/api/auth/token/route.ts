import { AppError, handleRoute, parseJson } from "@/lib/api";
import { tokenSchema } from "@/server/contracts";
import {
  assertDurableRateLimit,
  clientIp,
  recordDurableHit,
} from "@/server/services/ratelimit";
import { createTokenFromCredentials } from "@/server/services/token";

// Sign-in is the most attacked route on the service and the most expensive one
// to serve while failing: bcrypt at cost 12 is ~250ms of *blocking* CPU per
// attempt, so on a small instance a few dozen concurrent guesses saturate the
// event loop and degrade every other user. The limits below protect
// availability as much as they protect accounts.
//
// Only FAILED attempts are charged — a successful sign-in must never count
// toward a shared IP's budget, or carrier-grade NAT locks out real users.
const WINDOW_MS = 15 * 60_000;
/** Per source address. Generous: many legitimate users share one NAT address. */
const IP_FAILURE_LIMIT = 30;
/** Per targeted account. Tight: this is the brute-force ceiling that matters. */
const IDENTIFIER_FAILURE_LIMIT = 10;

export async function POST(request: Request) {
  return handleRoute(async () => {
    const input = await parseJson(request, tokenSchema);

    const ipKey = `auth_token:ip:${clientIp(request)}`;
    // Normalized so casing/whitespace variants can't buy a fresh budget against
    // the same account.
    const identifierKey = `auth_token:id:${input.identifier.trim().toLowerCase()}`;

    await assertDurableRateLimit(ipKey, IP_FAILURE_LIMIT, WINDOW_MS);
    await assertDurableRateLimit(identifierKey, IDENTIFIER_FAILURE_LIMIT, WINDOW_MS);

    try {
      return await createTokenFromCredentials(input.identifier, input.password);
    } catch (error) {
      if (error instanceof AppError && error.code === "INVALID_CREDENTIALS") {
        await Promise.all([
          recordDurableHit(ipKey, WINDOW_MS),
          recordDurableHit(identifierKey, WINDOW_MS),
        ]);
      }
      throw error;
    }
  });
}
