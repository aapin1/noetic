import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    // mobile/lib is limited to dependency-free pure modules (see reviewGate.ts)
    // — anything importing react-native can't run under this node runner.
    include: ["src/**/*.test.ts", "tests/**/*.test.ts", "mobile/lib/**/*.test.ts"],
    clearMocks: true,
  },
});
