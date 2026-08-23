import { defineConfig, devices } from "@playwright/test";

const pinchTest = /mobile globe supports two-finger pinch without losing region state/;
const linuxVisualCompatibility =
  process.platform === "linux"
    ? {
        // The committed field-guide baselines were captured with the same
        // Chromium build on macOS. Linux font rasterization changes edge pixels
        // without changing the composition, so compare against that reviewed
        // baseline with a bounded whole-page pixel budget. macOS remains exact.
        snapshotPathTemplate:
          "{testDir}/{testFilePath}-snapshots/{arg}-{projectName}-darwin{ext}",
        toHaveScreenshot: { maxDiffPixelRatio: 0.075 },
      }
    : {};

export default defineConfig({
  testDir: "./e2e",
  testIgnore: "**/live-pipeline.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  // Regional terrain intentionally waits up to 8s before using its fallback.
  expect: { timeout: 15_000, ...linuxVisualCompatibility },
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
      grepInvert: pinchTest,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // The test creates its own mobile context. A dedicated slow browser gives
      // Cesium's declared 600 ms startup camera flight time to settle before the
      // test records its pinch baseline, while keeping the behavioral assertion.
      name: "chromium-pinch",
      grep: pinchTest,
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: { slowMo: 750 },
      },
    },
  ],
});
