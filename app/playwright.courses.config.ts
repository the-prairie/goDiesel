import { defineConfig, devices } from "@playwright/test";

const external = process.env.GODIESEL_COURSE_PREVIEW_URL;
export default defineConfig({
  testDir: "./e2e",
  testMatch: "course-studio.spec.ts",
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 100_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: external ?? "http://127.0.0.1:8825",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: external
    ? undefined
    : {
        command: "npm run dev -- --port 8825 --strictPort --host 127.0.0.1",
        url: "http://127.0.0.1:8825",
        reuseExistingServer: false,
        timeout: 60_000,
      },
});
