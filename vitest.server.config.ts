import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "migrations/**/*.test.ts"],
    exclude: ["web/**", "e2e/**", "node_modules/**", "dist/**"],
    pool: "forks",
    poolOptions: {
      forks: { maxForks: 2, minForks: 1 },
    },
    testTimeout: 15_000,
  },
});
