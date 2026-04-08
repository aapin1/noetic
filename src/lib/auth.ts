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

export async function getRequestUserId(request: Request) {
  const authorization = request.headers.get("authorization");

  if (authorization?.startsWith("Bearer ")) {
    const token = authorization.slice("Bearer ".length).trim();
    const userId = await verifyApiToken(token);

    if (userId) {
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
