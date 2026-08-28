import { defineConfig, devices } from "@playwright/test";

const previewUrl = process.env.GODIESEL_ATLAS_PREVIEW_URL;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: previewUrl ?? "http://127.0.0.1:8787",
    headless: false,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: previewUrl
    ? undefined
    : {
        command: "npm run dev",
        url: "http://127.0.0.1:8787",
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
