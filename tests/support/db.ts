/**
 * Helpers for tests that run against the real `postgres_test` container
 * (docker-compose, port 5433) rather than a mocked service layer.
 *
 * These exercise route handlers exactly as Next.js calls them — a real
 * `Request` in, a real `Response` out — with real Prisma writes underneath and
 * replayed LLM responses (see llmFixtures.ts). Nothing is stubbed.
 */
import { randomUUID } from "node:crypto";
import { createApiToken, resetUserCache } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export { prisma };

/**
 * Truncation is destructive, so prove we're pointed at the throwaway database
 * before running it. Without this a stale `DATABASE_URL` — or forgetting the
 * `dotenv -e .env.test` prefix — would silently wipe the dev database instead.
 */
function assertTestDatabase() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.includes("mneme_test")) {
    const safe = url.replace(/\/\/[^@]*@/, "//***@") || "(unset)";
    throw new Error(
      `Refusing to reset: DATABASE_URL is not the test database.\n` +
        `  got: ${safe}\n` +
        `  run DB tests via "npm run test:db" (it loads .env.test).`,
    );
  }
}

let tables: string[] | null = null;

/** Empties every table. Call in `beforeEach` so tests can't leak into each other. */
export async function resetDb() {
  assertTestDatabase();

  if (!tables) {
    const rows = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    `;
    tables = rows.map((r) => r.tablename).filter((t) => !t.startsWith("_prisma"));
  }

  if (tables.length > 0) {
    const list = tables.map((t) => `"public"."${t}"`).join(", ");
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  }

  // auth.ts caches "this user id exists" for 60s; a truncate between tests
  // would otherwise let a deleted user keep authenticating.
  resetUserCache();
}

export type TestUser = {
  id: string;
  email: string;
  token: string;
};

/** Creates a user with a profile, preferences, and a real signed API token. */
export async function createTestUser(
  overrides: { handle?: string; displayName?: string; isOnboarded?: boolean; plan?: "FREE" | "PLUS" } = {},
): Promise<TestUser> {
  const suffix = randomUUID().slice(0, 8);
  const email = `test-${suffix}@example.com`;

  const user = await prisma.user.create({
    data: {
      email,
      name: overrides.displayName ?? "Test User",
      ...(overrides.plan ? { plan: overrides.plan } : {}),
      profile: {
        create: {
          handle: overrides.handle ?? `tester_${suffix}`,
          displayName: overrides.displayName ?? "Test User",
          isOnboarded: overrides.isOnboarded ?? true,
        },
      },
      preference: { create: {} },
    },
    select: { id: true, email: true },
  });

  return { id: user.id, email: user.email, token: await createApiToken(user.id) };
}

/** Builds a `Request` carrying a real Bearer token — the same path the app uses. */
export function authedRequest(
  user: TestUser,
  url: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Request {
  const headers: Record<string, string> = {
    authorization: `Bearer ${user.token}`,
    ...init.headers,
  };
  if (init.body !== undefined) headers["content-type"] = "application/json";

  return new Request(new URL(url, "http://localhost:3000").href, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
}

export type RouteResult<T> = {
  status: number;
  /** Unwrapped `data` on success, `null` on failure. */
  data: T;
  /** Unwrapped `error` on failure, `null` on success. */
  error: { code: string; message: string } | null;
  /** The raw `{ ok, data }` / `{ ok, error }` envelope, for asserting on it directly. */
  body: unknown;
};

/**
 * Reads a route handler's `Response`, unwrapping the `{ ok, data }` envelope
 * that `handleRoute` puts around every payload (see src/lib/api.ts).
 */
export async function readJson<T = unknown>(response: Response): Promise<RouteResult<T>> {
  const text = await response.text();
  let body: unknown;
  try {
    body = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  const envelope = body as { ok?: boolean; data?: unknown; error?: { code: string; message: string } } | null;
  return {
    status: response.status,
    data: (envelope?.ok ? envelope.data : null) as T,
    error: envelope?.ok === false ? (envelope.error ?? null) : null,
    body,
  };
}

/**
 * Several routes kick off work with `void somePromise` so the user isn't made
 * to wait on it (position-tension checks, tz bookkeeping). Those writes land
 * after the handler resolves, so a test that asserts on them has to give the
 * microtask queue — and the DB round-trip — a chance to drain first.
 */
export async function flushBackgroundWork(ms = 150) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
