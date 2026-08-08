import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { AppError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { createApiToken } from "@/lib/auth";
import type { RootDbClient } from "@/server/db";

/**
 * Sign in with Apple.
 *
 * The client hands us the `identityToken` from the native authorization flow.
 * Nothing else the client sends is trusted: email comes from the token's
 * verified claims, and the display name — which Apple only surfaces natively on
 * the very first authorization and never puts in the token — is accepted as an
 * unverified nicety, same trust level as the `name` field on registration.
 */

const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys";

/**
 * Audience must equal the app's iOS bundle identifier — mirrors
 * `ios.bundleIdentifier` in mobile/app.json. A token minted for any other app
 * (same Apple account, different client) must not authenticate here.
 */
export const APPLE_AUDIENCE = "app.mneme.mobile";

/** Lazy so tests never touch the network; cached because the JWKS rarely rotates. */
let remoteJwks: JWTVerifyGetKey | null = null;

function appleJwks(): JWTVerifyGetKey {
  if (!remoteJwks) {
    remoteJwks = createRemoteJWKSet(new URL(APPLE_JWKS_URL));
  }
  return remoteJwks;
}

export type VerifiedAppleIdentity = {
  /** Apple's stable user identifier for this app's team. */
  sub: string;
  /** Verified email from the token, if Apple included one. May be a private-relay address. */
  email: string | null;
};

/**
 * Verifies an Apple identity token: signature against Apple's JWKS, issuer,
 * audience, and expiry (jose rejects expired tokens by default).
 *
 * `getKey` is injectable for tests; production always uses Apple's JWKS.
 */
export async function verifyAppleIdentityToken(
  identityToken: string,
  opts: { getKey?: JWTVerifyGetKey; audience?: string } = {},
): Promise<VerifiedAppleIdentity> {
  try {
    const { payload } = await jwtVerify(identityToken, opts.getKey ?? appleJwks(), {
      issuer: APPLE_ISSUER,
      audience: opts.audience ?? APPLE_AUDIENCE,
      algorithms: ["RS256"],
    });

    if (!payload.sub) {
      throw new Error("missing sub");
    }

    return {
      sub: payload.sub,
      email: typeof payload.email === "string" ? payload.email.toLowerCase() : null,
    };
  } catch {
    // One opaque failure for every verification problem — signature, issuer,
    // audience, expiry, malformed. Distinguishing them helps an attacker
    // probe and helps no legitimate client.
    throw new AppError("INVALID_APPLE_TOKEN", "Apple sign-in could not be verified", 401);
  }
}

/**
 * Exchange a verified Apple identity for the same bearer-token response shape
 * as /api/auth/token, so everything downstream of sign-in is untouched.
 *
 * Account logic, in order:
 *  1. A user already carrying this Apple id signs straight in.
 *  2. Otherwise, a user with the token's (verified) email is LINKED — the
 *     Apple id is stored on the existing account rather than creating a
 *     duplicate. Private-relay addresses take this path like any other email.
 *  3. Otherwise a new account is created with no password. `fullName` is only
 *     ever available on the first authorization, which is exactly the
 *     create path — capture it here or leave name null (onboarding falls back
 *     to the email local-part / anonymous handle generation).
 */
export async function signInWithApple(args: {
  identity: VerifiedAppleIdentity;
  fullName?: string | null;
  db?: RootDbClient;
}) {
  const db = args.db ?? prisma;
  const { sub, email } = args.identity;

  let user = await db.user.findUnique({
    where: { appleUserId: sub },
    include: { profile: { select: { handle: true } } },
  });
  let isNewUser = false;

  if (!user && email) {
    const existing = await db.user.findUnique({
      where: { email },
      include: { profile: { select: { handle: true } } },
    });
    if (existing) {
      user = await db.user.update({
        where: { id: existing.id },
        data: { appleUserId: sub, emailVerified: existing.emailVerified ?? new Date() },
        include: { profile: { select: { handle: true } } },
      });
    }
  }

  if (!user) {
    if (!email) {
      // First-time sign-in with no email claim should not happen — Apple
      // includes the (possibly relayed) email in the identity token. If it
      // does, refuse rather than fabricate an address for a unique column.
      throw new AppError(
        "APPLE_EMAIL_MISSING",
        "Apple did not share an email for this account. Try again from Settings → Apple ID → Sign-In & Security.",
        422,
      );
    }

    const name = args.fullName?.trim() || null;
    user = await db.user.create({
      data: {
        email,
        appleUserId: sub,
        name,
        // Apple verified this address before minting the token.
        emailVerified: new Date(),
      },
      include: { profile: { select: { handle: true } } },
    });
    isNewUser = true;
  }

  const token = await createApiToken(user.id);

  return {
    token,
    userId: user.id,
    isNewUser,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      handle: user.profile?.handle ?? null,
    },
  };
}
