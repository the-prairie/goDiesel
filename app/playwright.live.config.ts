import { defineConfig, devices } from "@playwright/test";

const previewUrl = process.env.GODIESEL_ATLAS_PREVIEW_URL;
const localPreviewUrl = "http://localhost:8787";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: previewUrl ?? localPreviewUrl,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: previewUrl
    ? undefined
    : {
        command: "npm run dev",
        url: localPreviewUrl,
        reuseExistingServer: true,
        timeout: 120_000,
      },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
