import { defineConfig, devices } from "@playwright/test";

const captureMedia = process.env.GODIESEL_CAPTURE_WORLD_LIVE_MEDIA === "1";

export default defineConfig({
  outputDir: captureMedia
    ? "artifacts/world-pack-baseline/playwright-media"
    : "test-results",
  testDir: "./perf",
  testMatch: /world-pack-live-baseline\.perf\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 900_000,
  expect: { timeout: 180_000 },
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://localhost:8797",
    headless: false,
    screenshot: "only-on-failure",
    trace: captureMedia ? "on" : "retain-on-failure",
    video: captureMedia ? "on" : "off",
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command:
      "GODIESEL_DISABLE_LIVE_PROVIDERS=0 npm run typecheck && npx vite build && npx vite preview --host 0.0.0.0 --port 8797",
    url: "http://127.0.0.1:8797",
    reuseExistingServer: false,
    timeout: 240_000,
  },
  projects: [{ name: "owner-mac-desktop-chromium" }],
});
