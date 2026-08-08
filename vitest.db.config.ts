import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * The real-database suite. Kept separate from vitest.config.ts because that
 * one's tests stub `globalThis.fetch` themselves, which would fight the LLM
 * fixture interceptor installed here.
 *
 * Runs against the `postgres_test` container on 5433 (`npm run db:up`), with
 * env from .env.test — see the `test:db` script.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/db/**/*.test.ts"],
    setupFiles: ["./tests/support/setup-db.ts"],
    // One shared database, and every test truncates it — so files must not
    // overlap in time. Slower than the unit suite by design.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    // The capture pipeline is several sequential LLM round-trips; even
    // replayed, the surrounding Prisma work is not instant.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    clearMocks: true,
  },
});
