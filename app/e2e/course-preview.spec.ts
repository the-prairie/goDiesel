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
