import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { expect, test } from "@playwright/test";

const OUTPUT_DIR = path.resolve(process.cwd(), "artifacts/runtime-performance");
const requested = process.env.GODIESEL_LIVE_PROVIDER_PERF === "1";

function livePrerequisites() {
  const expectedHostname = process.env.GODIESEL_FIXED_GPU_HOSTNAME?.trim();
  if (!expectedHostname) {
    throw new Error(
      "GODIESEL_FIXED_GPU_HOSTNAME must name the approved reference host",
    );
  }
  const actualHostname = os.hostname();
  if (actualHostname !== expectedHostname) {
    throw new Error(
      `Live provider performance must run on ${expectedHostname}; received ${actualHostname}`,
    );
  }
  const providerCredentialConfigured = Boolean(
    process.env.VITE_GOOGLE_MAPS_API_KEY?.trim() ||
      process.env.GOOGLE_MAPS_API_KEY?.trim(),
  );
  if (!providerCredentialConfigured) {
    throw new Error("A real Google Maps provider credential is required");
  }
  return { actualHostname, expectedHostname, providerCredentialConfigured };
}

test("records fixed-host regional provider settlement", async ({ page }, testInfo) => {
  test.skip(
    !requested,
    "Set GODIESEL_LIVE_PROVIDER_PERF=1 and GODIESEL_FIXED_GPU_HOSTNAME on the fixed GPU host with provider credentials.",
  );
  const prerequisites = livePrerequisites();

  const started = performance.now();
  await page.goto("/#/atlas", { waitUntil: "domcontentloaded" });
  const atlas = page.locator('div[data-atlas-engine="cesium"]');
  await expect(atlas).toHaveAttribute("data-atlas-status", "ready", {
    timeout: 120_000,
  });
  const globalReadyMs = performance.now() - started;

  const regionSelect = page.getByRole("combobox", {
    name: "Browse route regions",
  });
  await expect(regionSelect).toBeVisible({ timeout: 60_000 });
  const regionalStarted = performance.now();
  await regionSelect.selectOption("Kyoto, Japan");
  await expect(atlas).toHaveAttribute("data-atlas-status", "region-ready", {
    timeout: 180_000,
  });
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
          fixedGpuHost: prerequisites.actualHostname === prerequisites.expectedHostname,
          fixedGpuHostname: prerequisites.actualHostname,
          providerCredentialConfigured: prerequisites.providerCredentialConfigured,
          liveProvidersDisabled: false,
        },
      },
      null,
      2,
    )}\n`,
  );
});
