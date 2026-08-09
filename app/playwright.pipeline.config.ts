import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 180_000,
  expect: { timeout: 60_000 },
  use: {
    baseURL: "http://127.0.0.1:8787",
    headless: false,
    screenshot: "only-on-failure",
    // Provider URLs contain credentials and private geometry before test redaction.
    trace: "off",
  },
  webServer: {
    command:
      "VITE_ADMIN_API_URL=http://127.0.0.1:8876 npm run dev",
    url: "http://127.0.0.1:8787",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: "live-pipeline-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
