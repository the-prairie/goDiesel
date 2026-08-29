import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./perf",
  testMatch: /world-pack-owner-performance\.perf\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 600_000,
  expect: { timeout: 30_000 },
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:8798",
    headless: false,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command:
      "GODIESEL_DISABLE_LIVE_PROVIDERS=1 npm run typecheck && npx vite build && npx vite preview --host 0.0.0.0 --port 8798",
    url: "http://127.0.0.1:8798",
    reuseExistingServer: false,
    timeout: 240_000,
  },
  projects: [{ name: "owner-mac-desktop-chromium" }],
});
