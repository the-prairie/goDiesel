import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { expect, test } from "@playwright/test";

const OUTPUT_DIR = path.resolve(process.cwd(), "artifacts/runtime-performance");
const enabled = process.env.GODIESEL_LIVE_PROVIDER_PERF === "1";

test("records fixed-host regional provider settlement", async ({ page }, testInfo) => {
  test.skip(
    !enabled,
    "Set GODIESEL_LIVE_PROVIDER_PERF=1 on the fixed GPU host with provider credentials.",
  );

  const started = performance.now();
  await page.goto("/#/atlas", { waitUntil: "domcontentloaded" });
  const atlas = page.locator('div[data-atlas-engine="cesium"]');
  await expect(atlas).toHaveAttribute("data-atlas-status", "ready", {
    timeout: 120_000,
  });
  const globalReadyMs = performance.now() - started;

  const regionButton = page.getByRole("button", {
    name: /Select Kyoto, Japan on globe/i,
  });
  await expect(regionButton).toBeVisible({ timeout: 60_000 });
  const regionalStarted = performance.now();
  await regionButton.click();
  await expect(atlas).toHaveAttribute(
    "data-atlas-status",
    /region-ready|region-fallback/,
    { timeout: 180_000 },
  );
  const regionalSettlementMs = performance.now() - regionalStarted;
  const status = await atlas.getAttribute("data-atlas-status");

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(
      OUTPUT_DIR,
      `runtime-live-provider-${testInfo.project.name}.json`,
    ),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        projectName: testInfo.project.name,
        globalReadyMs,
        regionalSettlementMs,
        regionalStatus: status,
        prerequisites: {
          fixedGpuHost: true,
          providerCredentialConfigured: true,
          liveProvidersDisabled: false,
        },
      },
      null,
      2,
    )}\n`,
  );
});
