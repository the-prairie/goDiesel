import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./perf",
  testMatch: /runtime-live-provider\.perf\.ts/,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 360_000,
  expect: { timeout: 180_000 },
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:8796",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command:
      "GODIESEL_DISABLE_LIVE_PROVIDERS=0 npm run build && npm run preview -- --port 8796",
    url: "http://127.0.0.1:8796",
    reuseExistingServer: false,
    timeout: 240_000,
  },
  projects: [
    {
      name: "desktop-chromium",
    },
  ],
});
