import { defineConfig, devices } from "@playwright/test";

// CI runs on Linux, and the only reviewed screenshot baselines are macOS
// (`*-darwin.png`). Rather than fail for a missing baseline or compare against
// another platform's pixels, CI skips screenshot comparisons and says so. The
// rest of each test, including the screenshot tests' other assertions, runs.
const ignoreSnapshotsInCi = Boolean(process.env.CI);
if (ignoreSnapshotsInCi) {
  console.warn(
    "Playwright: CI is set, so toHaveScreenshot comparisons are NOT checked " +
      "(ignoreSnapshots). Only -darwin baselines exist; compare them on macOS.",
  );
}

export default defineConfig({
  ...(ignoreSnapshotsInCi ? { ignoreSnapshots: true } : {}),
  testDir: "./e2e",
  testIgnore: "**/live-pipeline.spec.ts",
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
