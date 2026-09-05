import { defineConfig, devices } from "@playwright/test";
const baseURL = process.env.GODIESEL_WORLD_PREVIEW_URL;
if (!baseURL) throw new Error("BLOCKED: GODIESEL_WORLD_PREVIEW_URL must point to a live-key preview. This gate never substitutes test tiles for provider imagery.");
export default defineConfig({
  testDir: "./e2e", testMatch: "cinematic-world-live.spec.ts", workers: 1, retries: 0, timeout: 120_000,
  use: { ...devices["Desktop Chrome"], baseURL, headless: false, screenshot: "only-on-failure", trace: "retain-on-failure" },
});
