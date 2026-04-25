import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: process.env.AV_E2E_BASE ?? "http://localhost:5173",
    trace: "retain-on-failure",
    headless: true,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Allow override when the bundled browser version is unavailable in the local cache.
        launchOptions: process.env.AV_E2E_CHROMIUM_PATH
          ? { executablePath: process.env.AV_E2E_CHROMIUM_PATH }
          : undefined,
      },
    },
  ],
  webServer: {
    command: "npm run dev:frontend",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
