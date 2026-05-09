import { compare } from "bcryptjs";
import { AppError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { createApiToken } from "@/lib/auth";

export async function createTokenFromCredentials(email: string, password: string) {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    include: {
      profile: {
        select: { handle: true },
      },
    },
  });

  if (!user?.passwordHash) {
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
