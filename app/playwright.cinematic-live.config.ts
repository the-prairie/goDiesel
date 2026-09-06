import { defineConfig, devices } from "@playwright/test";
const baseURL = process.env.GODIESEL_WORLD_PREVIEW_URL;
if (!baseURL) throw new Error("BLOCKED: GODIESEL_WORLD_PREVIEW_URL must point to a live-key preview. This gate never substitutes test tiles for provider imagery.");
export default defineConfig({
  testDir: "./e2e",
  testMatch: "cinematic-world-live.spec.ts",
  // Keep synthetic screenshots alongside, not overwritten by, live evidence.
  outputDir: "test-results/cinematic-live",
  workers: 1,
  retries: 0,
  timeout: 180_000,
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    headless: true,
    screenshot: "only-on-failure",
    // Live traces contain the browser key and provider response bodies. Retain
    // redacted summaries and screenshots from the spec instead.
    trace: "off",
    serviceWorkers: "block",
  },
});
