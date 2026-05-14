// Vitest config for @autoviral/cli — scope to the local `test/` directory
// so vitest doesn't pick up the repo-root `web/vitest.config.ts` and try to
// run web suites from here.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    testTimeout: 15_000,
    pool: "forks",
    poolOptions: {
      forks: { maxForks: 2, minForks: 1 },
    },
  },
});
