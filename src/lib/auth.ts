import { PrismaAdapter } from "@next-auth/prisma-adapter";
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { compare, hash } from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { getServerSession } from "next-auth";
import { AppError } from "@/lib/api";
import { getEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";

function getAuthSecret() {
  return getEnv().NEXTAUTH_SECRET;
}

function getEncodedSecret() {
  return new TextEncoder().encode(getAuthSecret());
}

async function authorizeWithPassword(email: string, password: string) {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    include: { profile: { select: { handle: true } } },
  });

  if (!user?.passwordHash) {
    return null;
  }

  const isValid = await compare(password, user.passwordHash);

  if (!isValid) {
    return null;
  }

  return user;
}

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  session: {
    strategy: "jwt",
  },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials.password) {
          return null;
        }

        const user = await authorizeWithPassword(credentials.email, credentials.password);

        if (!user) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          handle: user.profile?.handle ?? null,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.handle = (user as { handle?: string | null }).handle ?? null;
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
        session.user.handle = token.handle ?? null;
      }

      return session;
    },
  },
  get secret() {
    return getAuthSecret();
  },
};

export async function getSession() {
  return getServerSession(authOptions);
}

export async function createPasswordHash(password: string) {
  return hash(password, 12);
}

export async function createApiToken(userId: string) {
  return new SignJWT({ sub: userId, typ: "api" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(getEncodedSecret());
}

export async function verifyApiToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, getEncodedSecret());
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

/**
 * Short-lived cache of "this user id exists", so the liveness check below costs
 * one query per user per minute instead of one per request.
 *
 * Only positive results are cached. A miss must stay a miss: caching "absent"
 * would keep a freshly registered user locked out for the TTL.
 *
 * `forgetUser` is called from the account-deletion path, so an in-app delete
 * invalidates immediately and the ghost-account behaviour described below still
 * cannot happen. The TTL only bounds out-of-band deletion — manual DB surgery
 * or a database reset — which is precisely the case where a stale minute is
 * harmless.
 */
const USER_EXISTS_TTL_MS = 60_000;
const MAX_CACHED_USERS = 50_000;
const knownUsers = new Map<string, number>();

function rememberUser(userId: string) {
  // Re-insert to move the key to the back: Map iteration is insertion-ordered,
  // which makes the eviction below least-recently-seen.
  knownUsers.delete(userId);
  knownUsers.set(userId, Date.now() + USER_EXISTS_TTL_MS);

  if (knownUsers.size > MAX_CACHED_USERS) {
    const oldest = knownUsers.keys().next();
    if (!oldest.done) knownUsers.delete(oldest.value);
  }
}

function userIsKnown(userId: string): boolean {
  const expiresAt = knownUsers.get(userId);
  if (expiresAt === undefined) return false;

  if (expiresAt <= Date.now()) {
    knownUsers.delete(userId);
    return false;
  }

  return true;
}

/** Invalidate a cached account. Call whenever a user row is removed. */
export function forgetUser(userId: string) {
  knownUsers.delete(userId);
}

/** Test seam: drop every cached account. */
export function resetUserCache() {
  knownUsers.clear();
}

export async function getRequestUserId(request: Request) {
  const authorization = request.headers.get("authorization");

  if (authorization?.startsWith("Bearer ")) {
    const token = authorization.slice("Bearer ".length).trim();
    const userId = await verifyApiToken(token);

    if (userId) {
      // A valid signature only proves we once issued this token — not that the
      // account still exists. If the user was deleted (or the DB was reset), a
      // stale device token must NOT authenticate; otherwise it silently "signs
      // in" to a ghost account and drops the user into onboarding. Confirm the
      // account is real before trusting the token.
      if (userIsKnown(userId)) return userId;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true },
      });

      if (!user) return null;

      rememberUser(userId);
      return userId;
    }
  }

  const session = await getSession();
  return session?.user?.id ?? null;
}

export async function requireRequestUserId(request: Request) {
  const userId = await getRequestUserId(request);

  if (!userId) {
    throw new AppError("UNAUTHORIZED", "Authentication is required", 401);
  }

  return userId;
}
