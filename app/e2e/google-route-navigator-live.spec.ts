import { mkdir } from "node:fs/promises";

import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";

const ROUTES = [
  { slug: "14736711660", label: "San Francisco" },
  { slug: "14023448720", label: "Crete" },
] as const;

const EVIDENCE_DIR = "e2e/evidence/auto-director";

async function captureEvidence(page: Page, filename: string) {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    path: `${EVIDENCE_DIR}/${filename}`,
  });
}

function expectNoRuntimeErrors(consoleErrors: string[], pageErrors: string[]) {
  expect(pageErrors).toEqual([]);
  expect(
    consoleErrors.filter(
      (message) =>
        !message.includes("favicon") &&
        !message.includes("Failed to load resource"),
    ),
  ).toEqual([]);
}

async function expectLiveSceneReady({
  consoleErrors,
  navigator,
  page,
  pageErrors,
  testInfo,
}: {
  consoleErrors: string[];
  navigator: Locator;
  page: Page;
  pageErrors: string[];
  testInfo: TestInfo;
}) {
  await expect
    .poll(async () => navigator.getAttribute("data-state"), {
      timeout: 30_000,
    })
    .not.toBe("loading");

  const state = await navigator.getAttribute("data-state");
  if (state !== "ready") {
    const alert = page.getByRole("alert");
    const visibleError =
      (await alert.count()) === 1 ? await alert.innerText() : "";
    await testInfo.attach("google-3d-provider-diagnostics", {
      body: Buffer.from(
        JSON.stringify(
          {
            consoleErrors,
            pageErrors,
            state,
            visibleError,
          },
          null,
          2,
        ),
      ),
      contentType: "application/json",
    });
  }

  expect(
    state,
    "Google 3D must be ready. Inspect the attached provider diagnostics when unavailable.",
  ).toBe("ready");
}

for (const route of ROUTES) {
  test(`navigates the ${route.label} route in native Google 3D`, async ({
    page,
  }, testInfo) => {
    test.skip(
      process.env.GODIESEL_LIVE_GOOGLE_3D_E2E !== "1",
      "Live Google 3D verification is opt-in.",
    );

    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(`/#/lab/google-route-navigator/${route.slug}`);

    const navigator = page.getByTestId("google-route-navigator");
    await expectLiveSceneReady({
      consoleErrors,
      navigator,
      page,
      pageErrors,
      testInfo,
    });
    await expect(page.locator("gmp-map-3d")).toBeVisible();
    await expect(page.locator("gmp-polyline-3d")).toHaveCount(4);
    await expect(page.getByTestId("google-route-playhead")).toBeAttached();
    await expect(page.getByTestId("google-route-controls")).toBeVisible();
    await expect(navigator).toHaveAttribute("data-hud-state", "expanded");
    await expect(navigator).toHaveAttribute("data-camera-mode", "auto");
    await expect(navigator).toHaveAttribute("data-directed-camera", "overview");
    await page.waitForTimeout(2_500);
    await captureEvidence(page, `${route.slug}-desktop-overview.png`);

    await page.getByRole("button", { name: "Play route" }).click();
    await expect(navigator).toHaveAttribute("data-hud-state", "expanded");
    await expect(page.getByTestId("replay-elevation-scrubber")).toBeVisible();
    const progress = page.getByTestId("google-route-progress");
    await expect
      .poll(async () => Number((await progress.textContent())?.split(" ")[0]))
      .toBeGreaterThan(0);
    const ribbonLayers = await page
      .locator("gmp-polyline-3d")
      .evaluateAll((elements) =>
        elements.map((element) => {
          const line = element as google.maps.maps3d.Polyline3DElement;
          return {
            opacity: Number(line.style.opacity),
            outerWidth: line.outerWidth,
            role: line.dataset.threadLayer,
            strokeWidth: line.strokeWidth,
          };
        }),
      );
    const ribbonLayer = (role: string) =>
      ribbonLayers.find((layer) => layer.role === role);
    expect(ribbonLayer("context")?.strokeWidth ?? 0).toBeGreaterThan(2.1);
    expect(ribbonLayer("context")?.strokeWidth ?? 99).toBeLessThan(2.7);
    expect(ribbonLayer("context")?.outerWidth ?? 0).toBeCloseTo(0.1);
    expect(ribbonLayer("context")?.opacity).toBeCloseTo(0.32);
    expect(ribbonLayer("future")?.strokeWidth ?? 0).toBeGreaterThan(1.3);
    expect(ribbonLayer("future")?.outerWidth ?? 0).toBeCloseTo(0.1);
    expect(ribbonLayer("traveled")?.strokeWidth ?? 0).toBeGreaterThan(2.2);
    expect(ribbonLayer("future")?.opacity).toBe(0);
    expect(ribbonLayer("traveled")?.opacity).toBe(0);
    expect(ribbonLayer("lead")?.opacity).toBe(0);
    expect(ribbonLayer("lead")?.strokeWidth ?? 0).toBeGreaterThan(
      ribbonLayer("traveled")?.strokeWidth ?? Number.POSITIVE_INFINITY,
    );
    expect(ribbonLayer("lead")?.outerWidth ?? 0).toBe(0);
    await expect(page.getByTestId("google-route-playhead")).toBeVisible();
    await expect(
      page.getByTestId("google-route-playhead").locator("div"),
    ).toHaveAttribute("data-moving", "true");
    await expect(
      page.getByTestId("google-route-playhead").locator("div"),
    ).toHaveAttribute("data-relative-bearing", /\d/);
    await page.waitForTimeout(3_500);
    await captureEvidence(page, `${route.slug}-desktop-playback.png`);
    await page.getByRole("button", { name: "Pause route" }).click();
    await expect(navigator).toHaveAttribute("data-hud-state", "expanded");

    await page
      .getByLabel("Route progress")
      .fill(String(route.slug === "14736711660" ? 14_250 : 10_750));
    await expect(navigator).toHaveAttribute("data-directed-camera", "chase");
    await expect(navigator).toHaveAttribute(
      "data-camera-protection",
      /recorded-terrain-envelope.*horizon-guard/,
    );
    await page.waitForTimeout(2_000);
    const automaticCamera = await page
      .locator("gmp-map-3d")
      .evaluate((element) => {
        const map = element as google.maps.maps3d.Map3DElement;
        return { range: map.range, tilt: map.tilt };
      });
    expect(automaticCamera.range).toBeGreaterThanOrEqual(390);
    expect(automaticCamera.range).toBeLessThanOrEqual(780);
    expect(automaticCamera.tilt).toBeLessThanOrEqual(58);
    await captureEvidence(page, `${route.slug}-desktop-chase.png`);

    await page.getByRole("button", { name: "Chase" }).click();
    await expect(navigator).toHaveAttribute("data-camera-mode", "chase");
    await page.getByRole("button", { name: "Overview" }).click();
    await expect(navigator).toHaveAttribute("data-camera-mode", "overview");

    await page.getByRole("button", { name: "Replay settings" }).click();
    await expect(
      page.getByRole("complementary", { name: "Replay settings panel" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Mesh" }).click();
    await expect(navigator).toHaveAttribute("data-grounding-mode", "mesh");
    await page.getByRole("button", { name: "Free" }).click();
    await expect(navigator).toHaveAttribute("data-following", "false");
    await page.getByRole("button", { name: "Resume following" }).click();
    await expect(navigator).toHaveAttribute("data-following", "true");

    expectNoRuntimeErrors(consoleErrors, pageErrors);
  });
}

for (const route of ROUTES) {
  test(`keeps the ${route.label} navigator usable on a phone viewport`, async ({
    page,
  }, testInfo) => {
    test.skip(
      process.env.GODIESEL_LIVE_GOOGLE_3D_E2E !== "1",
      "Live Google 3D verification is opt-in.",
    );

    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/#/lab/google-route-navigator/${route.slug}`);

    const navigator = page.getByTestId("google-route-navigator");
    await expectLiveSceneReady({
      consoleErrors,
      navigator,
      page,
      pageErrors,
      testInfo,
    });
    const controls = page.getByTestId("google-route-controls");
    await expect(controls).toBeVisible();

    const [navigatorBox, controlsBox] = await Promise.all([
      navigator.boundingBox(),
      controls.boundingBox(),
    ]);
    expect(navigatorBox).not.toBeNull();
    expect(controlsBox).not.toBeNull();
    expect(
      (controlsBox?.x ?? 0) + (controlsBox?.width ?? 0),
    ).toBeLessThanOrEqual(390);
    expect(
      (controlsBox?.y ?? 0) + (controlsBox?.height ?? 0),
    ).toBeLessThanOrEqual(navigatorBox?.height ?? 0);
    await expect(
      page.getByRole("button", { name: "Play route" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Chase" })).toBeVisible();
    await page.getByRole("button", { name: "Play route" }).click();
    await expect(navigator).toHaveAttribute("data-hud-state", "expanded");
    await expect(page.getByTestId("replay-elevation-scrubber")).toBeVisible();
    await expect(page.getByText("Elapsed")).toBeVisible();
    await expect(page.getByText("Pace")).toBeVisible();
    await page.waitForTimeout(2_500);
    await captureEvidence(page, `${route.slug}-mobile-playback.png`);
    expectNoRuntimeErrors(consoleErrors, pageErrors);
  });
}

test("keeps production Story Flight composed over live Google terrain on a phone", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.GODIESEL_LIVE_GOOGLE_3D_E2E !== "1",
    "Live Google 3D verification is opt-in.",
  );

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/replay/14023448720");

  const replay = page.getByTestId("replay-stage");
  await expectLiveSceneReady({
    consoleErrors,
    navigator: replay,
    page,
    pageErrors,
    testInfo,
  });
  await expect(replay).toHaveAttribute("data-replay-shell", "story-flight");
  await expect(page.locator("gmp-map-3d")).toBeVisible();
  await expect(page.locator("gmp-polyline-3d")).toHaveCount(4);
  await expect(page.getByTestId("replay-active-chapter")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Chapter stepper" })).toBeVisible();

  const controls = page.getByTestId("story-flight-controls");
  const [replayBox, controlsBox] = await Promise.all([
    replay.boundingBox(),
    controls.boundingBox(),
  ]);
  expect(replayBox).not.toBeNull();
  expect(controlsBox).not.toBeNull();
  expect((controlsBox?.x ?? 0) + (controlsBox?.width ?? 0)).toBeLessThanOrEqual(390);
  expect((controlsBox?.y ?? 0) + (controlsBox?.height ?? 0)).toBeLessThanOrEqual(844);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);

  await page.getByRole("button", { name: "Play route" }).click();
  await expect(page.getByRole("button", { name: "Pause route" })).toBeVisible();
  await expect
    .poll(async () =>
      Number((await page.getByTestId("google-route-progress").textContent())?.split(" ")[0]),
    )
    .toBeGreaterThan(0);
  await page.waitForTimeout(2_500);
  await captureEvidence(page, "14023448720-story-flight-mobile-live.png");
  expectNoRuntimeErrors(consoleErrors, pageErrors);
});

test("frames an active Story Flight thread above the desktop HUD", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.GODIESEL_LIVE_GOOGLE_3D_E2E !== "1",
    "Live Google 3D verification is opt-in.",
  );

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/#/replay/14023448720");

  const replay = page.getByTestId("replay-stage");
  await expectLiveSceneReady({
    consoleErrors,
    navigator: replay,
    page,
    pageErrors,
    testInfo,
  });
  await page.getByLabel("Route progress").fill("10750");
  await page.getByRole("button", { name: "Play route" }).click();
  await expect(replay).toHaveAttribute("data-directed-camera", "chase");
  await page.waitForTimeout(2_500);
  await expect(replay).toHaveAttribute("data-hud-state", "hidden");
  await captureEvidence(
    page,
    "14023448720-story-flight-desktop-chase-immersive-live.png",
  );
  await replay.dispatchEvent("pointermove");
  await expect(replay).toHaveAttribute("data-hud-state", "expanded");
  await page.waitForTimeout(300);

  const subjectBand = {
    minimumY: Number(await replay.getAttribute("data-subject-band-min-y")),
    maximumY: Number(await replay.getAttribute("data-subject-band-max-y")),
  };
  const controlsBox = await page.getByTestId("replay-controls").boundingBox();
  expect(subjectBand.minimumY).toBeGreaterThan(0);
  expect(subjectBand.maximumY).toBeGreaterThan(subjectBand.minimumY);
  expect(subjectBand.maximumY).toBeLessThan(controlsBox?.y ?? 0);
  await expect(page.locator('[data-thread-layer="context"]')).toHaveAttribute(
    "data-route-visible",
    "false",
  );
  await expect(page.locator('[data-thread-layer="traveled"]')).toHaveAttribute(
    "data-route-visible",
    "true",
  );
  await expect(page.locator('[data-thread-layer="future"]')).toHaveAttribute(
    "data-route-visible",
    "true",
  );
  await captureEvidence(page, "14023448720-story-flight-desktop-chase-live.png");
  expectNoRuntimeErrors(consoleErrors, pageErrors);
});

test("keeps the San Francisco runner view above coarse mesh", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.GODIESEL_LIVE_GOOGLE_3D_E2E !== "1",
    "Live Google 3D verification is opt-in.",
  );

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/#/lab/google-route-navigator/14736711660");
  const navigator = page.getByTestId("google-route-navigator");
  await expectLiveSceneReady({
    consoleErrors,
    navigator,
    page,
    pageErrors,
    testInfo,
  });
  await page.getByRole("button", { name: "Runner" }).click();
  await page.getByLabel("Route progress").fill("4360");
  await expect(navigator).toHaveAttribute("data-camera-mode", "runner");
  await page.waitForTimeout(3_000);

  const camera = await page.locator("gmp-map-3d").evaluate((element) => {
    const map = element as google.maps.maps3d.Map3DElement;
    return {
      maxTilt: map.maxTilt,
      range: map.range,
      tilt: map.tilt,
    };
  });
  expect(camera.range).toBeGreaterThanOrEqual(150);
  expect(camera.tilt).toBeLessThanOrEqual(65);
  expect(camera.maxTilt).toBe(78);

  const filaments = await page
    .locator("gmp-polyline-3d")
    .evaluateAll((elements) =>
      elements.map(
        (element) =>
          (element as google.maps.maps3d.Polyline3DElement)
            .drawsOccludedSegments,
      ),
    );
  expect(filaments).toEqual([false, false, false, false]);
  await captureEvidence(page, "14736711660-desktop-runner.png");
  expectNoRuntimeErrors(consoleErrors, pageErrors);
});
