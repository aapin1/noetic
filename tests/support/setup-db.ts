/**
 * Per-file setup for the real-database suite: install LLM replay, neutralize
 * the cookie-session path, then start every test from an empty database.
 */
import { afterAll, afterEach, beforeEach, vi } from "vitest";
import { installLlmFixtures, takeFixtureMisses } from "./llmFixtures";
import { prisma, resetDb } from "./db";

/**
 * `getRequestUserId` falls back to `getServerSession()` when there's no Bearer
 * token, and next-auth reads `headers()` — which only exists inside a real Next
 * request scope. Calling a route handler directly has no such scope, so an
 * unauthenticated request would throw and surface as a 500 instead of the 401
 * the app actually returns.
 *
 * Returning null is the truthful stub here: these tests authenticate the way
 * the mobile app does, with a signed Bearer token, and never with a cookie.
 */
vi.mock("next-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next-auth")>()),
  getServerSession: vi.fn(async () => null),
}));

const restoreFetch = installLlmFixtures();

beforeEach(async () => {
  await resetDb();
  takeFixtureMisses();
});

/**
 * A fixture miss can't be allowed to pass as a green test — see the comment on
 * `takeFixtureMisses`. Background work fired with `void` can land after the test
 * body finishes, so this is the last point at which those misses are visible.
 */
afterEach(async () => {
  // Routes fire follow-up work with `void` (insight polish, position checks).
  // Truncating out from under an in-flight write makes Prisma log a P2025
  // stack that looks like a failure and isn't — let it land first.
  await new Promise((resolve) => setTimeout(resolve, 100));

  const missed = takeFixtureMisses();
  if (missed.length > 0) {
    throw new Error(
      `${missed.length} LLM call(s) had no fixture, so the pipeline silently ran its ` +
        `fallback path instead of the real one:\n\n${missed.join("\n\n")}`,
    );
  }
});

afterAll(async () => {
  restoreFetch();
  await prisma.$disconnect();
});
