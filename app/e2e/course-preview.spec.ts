import { expect, test, type Page } from "@playwright/test";
import type { GoogleRouteCameraPose } from "../src/surfaces/replay/playback/route-navigator-controller";

const courseId = "course-213a0076-6d18-5be9-9fb2-7a772888c6b5";
const savedCourse = {
  id: courseId,
  name: "Calgary saved course",
  description: "",
  activity: "Run",
  createdAt: "2026-10-21T07:00:00Z",
  source: { kind: "gpx", filename: "course.gpx" },
  warnings: [],
  segments: [
    [
      { lat: 51.04, lng: -114.05, elevationM: 1_050 },
      { lat: 51.05, lng: -114.05, elevationM: 1_060 },
    ],
    [
      { lat: 51.07, lng: -114.01 },
      { lat: 51.08, lng: -114.01 },
    ],
  ],
};

async function installPreviewEngine(page: Page, unavailable = false) {
  await page.addInitScript((fail) => {
    const runtime = window as typeof window & {
      __coursePreviewMounts: Array<unknown>;
      __coursePreviewDestroyed: number;
      __coursePreviewCameras: GoogleRouteCameraPose[];
      __coursePreviewReadCamera?: GoogleRouteCameraPose;
    };
    runtime.__coursePreviewMounts = [];
    runtime.__coursePreviewDestroyed = 0;
    runtime.__coursePreviewCameras = [];
    window.__GODIESEL_GOOGLE_ROUTE_NAVIGATOR_FACTORY__ = () => ({
      async mount(options) {
        runtime.__coursePreviewMounts.push(options.route);
        options.onStatus(
          fail
            ? { state: "unavailable", message: "The 3D map could not load." }
            : { state: "ready", message: "Test renderer ready." },
        );
      },
      readCamera: () => runtime.__coursePreviewReadCamera,
      setCamera(pose) {
        runtime.__coursePreviewCameras.push(structuredClone(pose));
      },
      setFollowing() {},
      setGrounding() {},
      setCinematicRoute() {},
      setRouteReveal() {},
      destroy() {
        runtime.__coursePreviewDestroyed += 1;
      },
    });
  }, unavailable);
  await page.route(`**/api/courses?id=${courseId}`, (route) =>
    route.fulfill({ json: { course: savedCourse } }),
  );
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
  { width: 320, height: 568 },
  { width: 844, height: 390 },
]) {
  test(`previews saved course sections with distance controls at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await installPreviewEngine(page);
    await page.goto(`/#/courses/${courseId}/preview`);
    const stage = page.getByTestId("course-preview-stage");
    await expect(stage).toHaveAttribute("data-state", "ready");
    await expect(
      page.getByRole("heading", { name: savedCourse.name }),
    ).toBeVisible();
    await expect(page.getByTestId("course-preview-controls")).toContainText(
      "Section 1 · Paused",
    );
    const dock = await page
      .getByTestId("course-preview-controls")
      .boundingBox();
    expect(dock?.height).toBeLessThan(145);
    expect(dock!.y).toBeGreaterThan(140);
    for (const button of await page
      .getByTestId("course-preview-controls")
      .getByRole("button")
      .all()) {
      const box = await button.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    }
    await expect(page.getByTestId("course-preview-profile")).toHaveAttribute(
      "data-profile-kind",
      "elevation",
    );
    await page
      .getByRole("button", { name: "Play preview", exact: true })
      .click();
    await expect
      .poll(async () =>
        Number(
          await page
            .getByRole("slider", { name: "Preview distance" })
            .inputValue(),
        ),
      )
      .toBeGreaterThan(0);
    await page
      .getByRole("button", { name: "Pause preview", exact: true })
      .click();
    const slider = page.getByRole("slider", { name: "Preview distance" });
    const track = await slider.boundingBox();
    await slider.click({
      position: { x: track!.width / 2, y: track!.height / 2 },
    });
    expect(Number(await slider.inputValue())).toBeCloseTo(556, -1);
    const pin = await page.getByTestId("course-preview-playhead").boundingBox();
    expect(pin!.width).toBe(pin!.height);
    expect(pin!.x + pin!.width / 2).toBeCloseTo(track!.x + track!.width / 2, 0);
    expect(pin!.y + pin!.height / 2).toBeCloseTo(
      track!.y + track!.height / 2,
      0,
    );
    await slider.press("Home");
    await expect(slider).toHaveValue("0");
    await slider.press("ArrowRight");
    await expect(slider).toHaveValue("1");
    await page.getByRole("button", { name: "Preview speed 1×" }).click();
    await expect(
      page.getByRole("button", { name: "Preview speed 2×" }),
    ).toBeVisible();
    await page.getByRole("slider", { name: "Preview distance" }).fill("500");
    await expect(page.getByTestId("course-preview-distance")).toHaveText(
      "0.50 / 1.11 km",
    );
    await page
      .getByRole("button", { name: "Preview settings", exact: true })
      .click();
    await expect(
      page.getByText("Planned course. No recorded pace or elapsed time."),
    ).toBeVisible();
    await page.getByRole("radio", { name: "Overview", exact: true }).click();
    await page
      .getByRole("combobox", { name: "Course section", exact: true })
      .click();
    await page
      .getByRole("option", { name: "Section 2 · 1.1 km", exact: true })
      .click();
    await expect(stage).toHaveAttribute("data-section", "2");
    await expect(
      page.getByRole("slider", { name: "Preview distance" }),
    ).toHaveValue("0");
    await expect(page.getByTestId("course-preview-profile")).toHaveAttribute(
      "data-profile-kind",
      "distance",
    );
    await expect(
      page.getByText("Elevation unavailable · Overview"),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Preview settings", exact: true })
      .click();
    await expect(
      page.getByText(
        "Elevation is incomplete. The camera uses a high overview.",
      ),
    ).toBeVisible();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    const mounts = await page.evaluate(
      () =>
        (
          window as typeof window & {
            __coursePreviewMounts: Array<{
              route: Array<{ lat: number; lng: number }>;
            }>;
          }
        ).__coursePreviewMounts,
    );
    expect(mounts.at(-1)?.route).toEqual([
      { lat: 51.07, lng: -114.01, d: 0 },
      { lat: 51.08, lng: -114.01, d: expect.any(Number) },
    ]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page
      .getByRole("link", { name: "Back to course", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`#/courses/${courseId}$`));
    expect(
      await page.evaluate(
        () =>
          (window as typeof window & { __coursePreviewDestroyed: number })
            .__coursePreviewDestroyed,
      ),
    ).toBeGreaterThan(0);
  });
}

test("reports a provider failure without enabling playback and retries the renderer", async ({
  page,
}) => {
  await installPreviewEngine(page, true);
  await page.goto(`/#/courses/${courseId}/preview`);
  await expect(page.getByRole("alert")).toContainText("3D preview unavailable");
  await expect(
    page.getByRole("button", { name: "Play preview", exact: true }),
  ).toBeDisabled();
  const mounts = () =>
    page.evaluate(
      () =>
        (window as typeof window & { __coursePreviewMounts: unknown[] })
          .__coursePreviewMounts.length,
    );
  const before = await mounts();
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect.poll(mounts).toBeGreaterThan(before);
});

test("loads again after a saved course request fails", async ({ page }) => {
  await installPreviewEngine(page);
  let available = false;
  await page.route(`**/api/courses?id=${courseId}`, (route) => {
    return route.fulfill(
      !available
        ? { status: 503, json: { error: "Course workspace unavailable." } }
        : { json: { course: savedCourse } },
    );
  });
  await page.goto(`/#/courses/${courseId}/preview`);
  await expect(page.getByRole("alert")).toHaveText(
    "Course workspace unavailable.",
  );
  available = true;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByTestId("course-preview-stage")).toHaveAttribute(
    "data-state",
    "ready",
  );
});

test("settles camera changes while paused and hands free exploration back to Follow", async ({
  page,
}) => {
  await installPreviewEngine(page);
  await page.goto(`/#/courses/${courseId}/preview`);
  await expect(page.getByTestId("course-preview-stage")).toHaveAttribute(
    "data-state",
    "ready",
  );
  await page.evaluate(() => {
    (
      window as typeof window & {
        __coursePreviewCameras: GoogleRouteCameraPose[];
      }
    ).__coursePreviewCameras = [];
  });
  await page
    .getByRole("button", { name: "Preview settings", exact: true })
    .click();
  await expect(
    page.getByText("Planned course. No recorded pace or elapsed time."),
  ).toBeVisible();
  await page.getByRole("radio", { name: "Overview", exact: true }).click();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  const cameras = () =>
    page.evaluate(
      () =>
        (
          window as typeof window & {
            __coursePreviewCameras: GoogleRouteCameraPose[];
          }
        ).__coursePreviewCameras,
    );
  const first = (await cameras())[0];
  expect(first.rangeM).toBeGreaterThan(650);
  expect(first.rangeM).toBeLessThan(700);
  expect(first.tiltDeg).toBeGreaterThan(45);
  await expect
    .poll(async () => (await cameras()).at(-1)?.rangeM)
    .toBeGreaterThan(1_499);
  await expect(
    page.getByRole("button", { name: "Play preview", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel(`Google photorealistic 3D view of ${savedCourse.name}`)
    .click({ position: { x: 300, y: 200 } });
  await page.evaluate(() => {
    const runtime = window as typeof window & {
      __coursePreviewCameras: GoogleRouteCameraPose[];
      __coursePreviewReadCamera: GoogleRouteCameraPose;
    };
    runtime.__coursePreviewReadCamera = {
      center: { lat: 51.06, lng: -114.04, altitude: 1_050 },
      rangeM: 2_000,
      tiltDeg: 30,
      headingDeg: 20,
      fovDeg: 54,
      progressM: 0,
    };
    runtime.__coursePreviewCameras = [];
  });
  await page.getByRole("button", { name: "Follow", exact: true }).click();
  const restored = (await cameras())[0];
  expect(restored.rangeM).toBeGreaterThan(1_950);
  expect(restored.center.lat).toBeGreaterThan(51.059);
  await expect
    .poll(async () => (await cameras()).at(-1)?.rangeM)
    .toBeLessThan(1_501);
});

test("applies camera changes immediately when reduced motion is requested", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installPreviewEngine(page);
  await page.goto(`/#/courses/${courseId}/preview`);
  await expect(page.getByTestId("course-preview-stage")).toHaveAttribute(
    "data-state",
    "ready",
  );
  await page.evaluate(() => {
    (
      window as typeof window & {
        __coursePreviewCameras: GoogleRouteCameraPose[];
      }
    ).__coursePreviewCameras = [];
  });
  await page
    .getByRole("button", { name: "Preview settings", exact: true })
    .click();
  await expect(
    page.getByText("Planned course. No recorded pace or elapsed time."),
  ).toBeVisible();
  await page.getByRole("radio", { name: "Overview", exact: true }).click();
  const first = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __coursePreviewCameras: GoogleRouteCameraPose[];
        }
      ).__coursePreviewCameras[0],
  );
  expect(first.rangeM).toBe(1_500);
  expect(first.tiltDeg).toBe(0);
});

// Google rejects the key after its script has loaded: the engine publishes an
// unavailable status with reason "authentication", and Google injects its own
// error dialog (.gm-err-container) into the map host with an extreme z-index.
// `__GODIESEL_REJECT_KEY__` publishes the rejection.
async function installKeyRejectedPreview(page: Page) {
  await installPreviewEngine(page);
  await page.addInitScript(() => {
    const runtime = window as unknown as Record<string, unknown>;
    window.__GODIESEL_GOOGLE_ROUTE_NAVIGATOR_FACTORY__ = () => ({
      async mount({ container, onStatus }) {
        onStatus({ state: "loading", message: "Loading Google photorealistic 3D." });
        const canvas = document.createElement("canvas");
        canvas.style.cssText = "width:100%;height:100%;background:rgb(30,80,96)";
        const error = document.createElement("div");
        error.className = "gm-err-container";
        error.style.cssText = "position:absolute;inset:0;z-index:2147483647;display:grid;place-items:center;background:#e5e3df;color:#3c4043";
        error.innerHTML = '<div class="gm-err-content"><div class="gm-err-title">Oops! Something went wrong.</div><div class="gm-err-message">This page didn\'t load Google Maps correctly. See the JavaScript console for technical details.</div></div>';
        container.replaceChildren(canvas, error);
        runtime.__GODIESEL_REJECT_KEY__ = () => onStatus({
          state: "unavailable",
          message: "Google Maps rejected this browser origin. Add the current localhost or preview URL to the key restrictions.",
        }, "authentication");
      },
      readCamera: () => undefined,
      setCamera() {}, setFollowing() {}, setGrounding() {}, setCinematicRoute() {}, setRouteReveal() {}, destroy() {},
    });
  });
}

/** Proves the injected Google node cannot be seen through or above the page. */
async function googleErrorExposure(page: Page) {
  return page.evaluate(() => {
    const stage = document.querySelector<HTMLElement>('[data-testid="course-preview-stage"]')!;
    const error = stage.querySelector<HTMLElement>(".gm-err-container")!;
    const host = error.parentElement!;
    const backdrop = stage.querySelector<HTMLElement>('[data-testid="course-preview-provider-backdrop"]');
    const errorBox = error.getBoundingClientRect();
    const backdropBox = backdrop?.getBoundingClientRect();
    const background = backdrop ? getComputedStyle(backdrop).backgroundColor : "transparent";
    const match = background.match(/\/\s*([\d.]+)(%?)\s*\)$/) ?? background.match(/^rgba\([^)]*,\s*([\d.]+)\)$/);
    const alpha = background === "transparent" ? 0 : match ? Number(match[1]) / (match[2] === "%" ? 100 : 1) : 1;
    const leaks: string[] = [];
    for (let row = 1; row < 6; row++) {
      for (let column = 1; column < 6; column++) {
        const x = errorBox.left + errorBox.width * column / 6;
        const y = errorBox.top + errorBox.height * row / 6;
        const target = document.elementFromPoint(x, y);
        if (target && host.contains(target)) leaks.push(`${Math.round(x)},${Math.round(y)}`);
      }
    }
    return {
      covers: !!backdropBox && backdropBox.left <= errorBox.left && backdropBox.top <= errorBox.top
        && backdropBox.right >= errorBox.right && backdropBox.bottom >= errorBox.bottom,
      backdropAlpha: alpha,
      hostIsolated: getComputedStyle(host).isolation === "isolate",
      leaks,
    };
  });
}

for (const device of [
  { name: "phone", viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
  { name: "desktop", viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false, deviceScaleFactor: 1 },
]) {
  test.describe(`a rejected Google key on a ${device.name}`, () => {
    test.use({ viewport: device.viewport, hasTouch: device.hasTouch, isMobile: device.isMobile, deviceScaleFactor: device.deviceScaleFactor });

    test("hides Google's error UI, says 3D is unavailable and leads back to the course", async ({ page }) => {
      await installKeyRejectedPreview(page);
      await page.goto(`/#/courses/${courseId}/preview`);
      const stage = page.getByTestId("course-preview-stage");
      await expect(stage).toHaveAttribute("data-state", "loading");
      // While loading the host stays live under the opaque backdrop (which
      // lets pointer events through), so only coverage is asserted here.
      expect(await googleErrorExposure(page)).toMatchObject({ covers: true, backdropAlpha: 1, hostIsolated: true });

      await page.evaluate(() => (window as unknown as { __GODIESEL_REJECT_KEY__: () => void }).__GODIESEL_REJECT_KEY__());
      const alert = page.getByRole("alert");
      await expect(alert).toContainText("Google 3D is unavailable");
      await expect(alert).toContainText("Google is not serving photorealistic 3D to this site right now.");
      await expect(alert).not.toContainText(/API key|key restrictions|origin|localhost|InvalidKeyMapError|Error/i);
      expect(await googleErrorExposure(page)).toEqual({ covers: true, backdropAlpha: 1, hostIsolated: true, leaks: [] });
      await expect(page.getByTestId("course-preview-map-host")).toHaveAttribute("inert", "");
      await expect(page.locator(".gm-err-container")).toBeHidden();
      expect(await page.locator(".gm-err-title").evaluate(element =>
        element.checkVisibility({ visibilityProperty: true, opacityProperty: true }))).toBe(false);
      await expect(page.getByRole("heading", { name: savedCourse.name })).toBeVisible();
      await expect(page.getByTestId("course-preview-controls")).toBeVisible();
      await expect(alert.getByRole("button", { name: "Try again" })).toHaveCount(0);
      await alert.getByRole("link", { name: "Back to course", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`#/courses/${courseId}$`));
    });
  });
}
