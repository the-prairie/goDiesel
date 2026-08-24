import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./perf",
  testMatch: /runtime-browser\.perf\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 600_000,
  expect: { timeout: 60_000 },
  use: {
    baseURL: "http://127.0.0.1:8794",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "GODIESEL_DISABLE_LIVE_PROVIDERS=1 npm run typecheck && npx vite build --config vite.runtime-perf.config.ts && npx vite preview --config vite.runtime-perf.config.ts --host 0.0.0.0 --port 8794",
    url: "http://127.0.0.1:8794",
    reuseExistingServer: false,
    timeout: 240_000,
  },
  projects: [
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "mobile-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 430, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
      },
    },
  ],
});
