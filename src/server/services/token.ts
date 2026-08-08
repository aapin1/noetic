import { compare } from "bcryptjs";
import { AppError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { createApiToken } from "@/lib/auth";
import type { RootDbClient } from "@/server/db";

export async function createTokenFromCredentials(
  identifier: string,
  password: string,
  db: RootDbClient = prisma,
) {
  const trimmed = identifier.trim();
  // An identifier with "@" is an email; otherwise treat it as a profile handle.
  const isEmail = trimmed.includes("@");
  const user = isEmail
    ? await db.user.findUnique({
        where: { email: trimmed.toLowerCase() },
        include: { profile: { select: { handle: true } } },
      })
    : await db.user.findFirst({
        where: { profile: { handle: trimmed.toLowerCase() } },
        include: { profile: { select: { handle: true } } },
      });

  if (!user?.passwordHash) {
    // An Apple-created account has no password at all — no guess can ever be
    // right, so pointing at the real sign-in method beats an endless
    // "invalid credentials" loop. This does confirm the account exists, but
    // only for accounts that a password can never open anyway.
    if (user?.appleUserId) {
      throw new AppError(
        "USE_APPLE_SIGN_IN",
        "this account uses sign in with apple.",
        401,
      );
    }
    throw new AppError("INVALID_CREDENTIALS", "Invalid credentials", 401);
  }

  const valid = await compare(password, user.passwordHash);

  if (!valid) {
    throw new AppError("INVALID_CREDENTIALS", "Invalid credentials", 401);
  }

  const token = await createApiToken(user.id);

  return {
    token,
    userId: user.id,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      handle: user.profile?.handle ?? null,
    },
  };
}
