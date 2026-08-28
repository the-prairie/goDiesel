import { defineConfig, devices } from "@playwright/test";

const port = Number.parseInt(process.env.GODIESEL_PERF_PORT ?? "8794", 10);
const baseURL = `http://127.0.0.1:${port}`;

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
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      `GODIESEL_DISABLE_LIVE_PROVIDERS=1 npm run typecheck && npx vite build --config vite.runtime-perf.config.ts && npx vite preview --config vite.runtime-perf.config.ts --host 0.0.0.0 --port ${port}`,
    url: baseURL,
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
