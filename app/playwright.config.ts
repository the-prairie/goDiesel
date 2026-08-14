import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testIgnore: ["**/live-pipeline.spec.ts", "**/*-live.spec.ts"],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  // Regional terrain intentionally waits up to 8s before using its fallback.
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://127.0.0.1:8791",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "GODIESEL_DISABLE_LIVE_PROVIDERS=1 npm run build && npm run preview -- --port 8791",
    url: "http://127.0.0.1:8791",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
