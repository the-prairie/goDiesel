import { defineConfig, devices } from "@playwright/test";

const liveProviderFiles = "**/*-live.spec.ts";
const runningOnLinux = process.platform === "linux";

export default defineConfig({
  testDir: "./e2e",
  testIgnore: ["**/live-pipeline.spec.ts", liveProviderFiles],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  // The field-guide references were reviewed in the same Chromium build on
  // macOS. Linux font rasterization changes a small number of edge pixels but
  // not the composition. Measured severe pixel differences are below 2.3%, so
  // Linux keeps the reviewed baseline with a bounded 3% budget; macOS is exact.
  snapshotPathTemplate: runningOnLinux
    ? "{testDir}/{testFilePath}-snapshots/{arg}-{projectName}-darwin{ext}"
    : undefined,
  // Regional terrain intentionally waits up to 8s before using its fallback.
  expect: {
    timeout: 15_000,
    ...(runningOnLinux
      ? { toHaveScreenshot: { maxDiffPixelRatio: 0.03 } }
      : {}),
  },
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
      testIgnore: ["**/live-pipeline.spec.ts", liveProviderFiles],
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
