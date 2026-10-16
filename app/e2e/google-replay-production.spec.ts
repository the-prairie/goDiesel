import { expect, test, type Page } from "@playwright/test";

async function installGoogleReplay(page: Page, state: "ready" | "unavailable" | "loading") {
  await page.addInitScript((providerState) => {
    const replayWindow = window as typeof window & {
      __GODIESEL_SET_PROVIDER_STATUS__?: (state: "ready" | "loading" | "unavailable") => void;
      __GODIESEL_CAMERA_CALLS__?: Array<{
        center: { lat: number; lng: number };
        headingDeg: number;
      }>;
      __GODIESEL_CINEMATIC_ROUTE_CALLS__?: Array<{
        startRatio: number;
        focusRatio: number;
        endRatio: number;
      }>;
      __GODIESEL_GOOGLE_ROUTE_NAVIGATOR_FACTORY__?: () => {
        mount(options: {
          container: HTMLElement;
          onStatus: (status: {
            state: "ready" | "unavailable" | "loading";
            message: string;
          }) => void;
        }): Promise<void>;
        setCamera(): void;
        setFollowing(): void;
        setGrounding(): void;
        setCinematicRoute(treatment: {
          startRatio: number;
          focusRatio: number;
          endRatio: number;
        }): void;
        setRouteReveal(): void;
        destroy(): void;
      };
      __GODIESEL_REPLAY_ENGINE_FACTORY__?: () => {
        mount(options: {
          container: HTMLElement;
          onStatus: (status: {
            state: "ready";
            title: string;
            message: string;
          }) => void;
        }): Promise<void>;
        setPose(): void;
        destroy(): void;
      };
    };

    replayWindow.__GODIESEL_CINEMATIC_ROUTE_CALLS__ = [];
    replayWindow.__GODIESEL_CAMERA_CALLS__ = [];
    replayWindow.__GODIESEL_GOOGLE_ROUTE_NAVIGATOR_FACTORY__ = () => ({
      async mount({ container, onStatus }) {
        replayWindow.__GODIESEL_SET_PROVIDER_STATUS__ = (state) => onStatus({ state, message: `Google 3D fixture ${state}.` });
        if (providerState === "unavailable") {
          onStatus({
            state: "unavailable",
            message: "Google 3D fixture unavailable.",
          });
          return;
        }
        const canvas = document.createElement("canvas");
        canvas.dataset.renderer = "google-production";
        canvas.style.background = "rgb(30, 80, 96)";
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        const credits = document.createElement("button");
        credits.textContent = "Provider information fixture";
        credits.style.cssText = "position:absolute;bottom:4px;right:10px;height:24px";
        credits.onclick = () => { credits.textContent = "Provider information opened"; };
        container.replaceChildren(canvas, credits);
        onStatus({ state: providerState, message: `Google 3D fixture ${providerState}.` });
      },
      setCamera(pose: {
        center: { lat: number; lng: number };
        headingDeg: number;
      }) {
        replayWindow.__GODIESEL_CAMERA_CALLS__?.push(pose);
      },
      setFollowing() {},
      setGrounding() {},
      setCinematicRoute(treatment) {
        replayWindow.__GODIESEL_CINEMATIC_ROUTE_CALLS__?.push(treatment);
      },
      setRouteReveal() {},
      destroy() {},
    });

    replayWindow.__GODIESEL_REPLAY_ENGINE_FACTORY__ = () => ({
      async mount({ container, onStatus }) {
        const canvas = document.createElement("canvas");
        canvas.dataset.renderer = "atlas-fallback";
        container.replaceChildren(canvas);
        onStatus({
          state: "ready",
          title: "Atlas replay ready",
          message: "Fallback fixture ready.",
        });
      },
      setPose() {},
      destroy() {},
    });
  }, state);
}

for (const routeSlug of ["14023448720", "14736711660"] as const) {
  test(`opens production Replay in Google 3D for ${routeSlug}`, async ({
    page,
  }) => {
    await installGoogleReplay(page, "ready");
    await page.goto(`/#/replay/${routeSlug}`);

    const replay = page.getByTestId("replay-stage");
    await expect(replay).toHaveAttribute("data-engine", "google-3d-maps");
    await expect(replay).toHaveAttribute("data-state", "ready");
    await expect(replay).toHaveAttribute("data-camera-mode", "auto");
    await expect(replay).toHaveAttribute("data-grounding-mode", "ground");
    if (routeSlug === "14736711660") await expect(page.getByRole("heading", { name: "just here for the zipper", exact: true })).toBeVisible();
    await expect(replay).toHaveAttribute("data-directed-camera", "overview");
    await expect(
      page.getByRole("button", { name: "Auto director" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByText("Google 3D Replay", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Change route" }),
    ).toBeVisible();
    const scrubber = page.getByTestId("replay-elevation-scrubber");
    await expect(scrubber).toBeVisible();

    await page.getByRole("button", { name: "Play route" }).click();
    await expect(replay).toHaveAttribute("data-hud-state", "expanded");
    await expect(
      page.getByRole("button", { name: "Pause route" }),
    ).toBeVisible();
    await expect(scrubber).toBeVisible();
    await expect(page.getByText("Grade", { exact: true })).toBeVisible();
    await page.evaluate(() => {
      const replayWindow = window as typeof window & {
        __GODIESEL_CAMERA_CALLS__?: unknown[];
      };
      replayWindow.__GODIESEL_CAMERA_CALLS__ = [];
    });
    await expect
      .poll(async () =>
        Number(
          (
            await page.getByTestId("google-route-progress").textContent()
          )?.split(" ")[0],
        ),
      )
      .toBeGreaterThan(0);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const replayWindow = window as typeof window & {
            __GODIESEL_CINEMATIC_ROUTE_CALLS__?: Array<{
              focusRatio: number;
            }>;
          };
          return replayWindow.__GODIESEL_CINEMATIC_ROUTE_CALLS__?.at(-1)
            ?.focusRatio;
        }),
      )
      .toBeGreaterThan(0);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as typeof window & {
                __GODIESEL_CAMERA_CALLS__?: unknown[];
              }
            ).__GODIESEL_CAMERA_CALLS__?.length ?? 0,
        ),
      )
      .toBeGreaterThan(8);
    const cameraMotion = await page.evaluate(() => {
      const calls =
        (
          window as typeof window & {
            __GODIESEL_CAMERA_CALLS__?: Array<{
              center: { lat: number; lng: number };
              headingDeg: number;
            }>;
          }
        ).__GODIESEL_CAMERA_CALLS__ ?? [];
      const steps = calls.slice(1).map((call, index) => {
        const previous = calls[index];
        return {
          eastM:
            (call.center.lng - previous.center.lng) *
            111_320 *
            Math.cos((call.center.lat * Math.PI) / 180),
          northM: (call.center.lat - previous.center.lat) * 111_320,
        };
      });
      return {
        count: calls.length,
        peakAccelerationM: Math.max(
          0,
          ...steps
            .slice(1)
            .map((step, index) =>
              Math.hypot(
                step.eastM - steps[index].eastM,
                step.northM - steps[index].northM,
              ),
            ),
        ),
      };
    });
    expect(cameraMotion.count).toBeGreaterThan(8);
    expect(cameraMotion.peakAccelerationM).toBeLessThan(2);
    await page.getByRole("button", { name: "Pause route" }).click();
    const routeCallCount = await page.evaluate(
      () =>
        (
          window as typeof window & {
            __GODIESEL_CINEMATIC_ROUTE_CALLS__?: unknown[];
          }
        ).__GODIESEL_CINEMATIC_ROUTE_CALLS__?.length ?? 0,
    );
    await page.waitForTimeout(180);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as typeof window & {
                __GODIESEL_CINEMATIC_ROUTE_CALLS__?: unknown[];
              }
            ).__GODIESEL_CINEMATIC_ROUTE_CALLS__?.length ?? 0,
        ),
      )
      .toBe(routeCallCount);
  });
}

test("falls back from Google 3D to Atlas replay", async ({ page }) => {
  await installGoogleReplay(page, "unavailable");
  await page.goto("/#/replay/14023448720");

  await expect(page.getByRole("alert")).toContainText("3D world unavailable");
  await page.getByRole("button", { name: "Use Atlas replay" }).click();

  const replay = page.getByTestId("replay-stage");
  await expect(replay).toHaveAttribute("data-engine", "maplibre-atlas");
  await expect(replay).toHaveAttribute("data-state", "ready");
  await expect(page.locator('[data-renderer="atlas-fallback"]')).toBeVisible();
});

test("keeps playback telemetry visible on a phone", async ({ page }) => {
  await installGoogleReplay(page, "ready");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/replay/14023448720");

  const dock = page.getByTestId("replay-controls");
  await page.getByRole("button", { name: "Play route" }).click();
  await expect(page.getByTestId("replay-elevation-scrubber")).toBeVisible();
  await expect(page.getByText("Grade", { exact: true })).toBeVisible();
  expect((await dock.boundingBox())?.height ?? 0).toBeLessThan(170);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
});

test("commits the final playback state after a throttled UI update", async ({
  page,
}) => {
  await installGoogleReplay(page, "ready");
  await page.goto("/#/replay/14023448720");

  const progress = page.getByTestId("google-route-progress");
  await page.getByRole("button", { name: "Play route" }).click();
  await expect
    .poll(async () => Number((await progress.textContent())?.split(" ")[0]))
    .toBeGreaterThan(0);

  const scrubber = page.getByLabel("Route progress");
  const maximum = Number(await scrubber.getAttribute("max"));
  await scrubber.fill(String(Math.floor(maximum) - 1));

  await expect(page.getByRole("button", { name: "Play route" })).toBeVisible({
    timeout: 1_000,
  });
  await expect(progress).toContainText(`${(maximum / 1_000).toFixed(2)} /`);
});

for (const width of [320, 390, 820, 1280]) {
  test(`redesigned Replay keeps metric text separate at ${width}px`, async ({
    page,
  }) => {
    await installGoogleReplay(page, "ready");
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/#/replay/14736711660");
    await expect(page.getByTestId("replay-stage")).toHaveAttribute(
      "data-state",
      "ready",
    );
    const progress = page.getByTestId("google-route-progress");
    expect(
      await progress.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
    ).toBe(true);
    const metrics = page.locator(".replay-metrics");
    const cells = await metrics
      .locator(":scope > div")
      .evaluateAll((elements) =>
        elements.map((element) => {
          const box = element.getBoundingClientRect();
          return {
            left: box.left,
            right: box.right,
            width: element.clientWidth,
            contentWidth: element.scrollWidth,
          };
        }),
      );
    expect(cells).toHaveLength(4);
    cells.forEach((cell, index) => {
      expect(cell.contentWidth).toBeLessThanOrEqual(cell.width + 1);
      if (index > 0)
        expect(cell.left).toBeGreaterThanOrEqual(cells[index - 1].right);
    });
    if (width < 640) {
      await page
        .getByRole("button", { name: "Replay settings", exact: true })
        .click();
      await page.getByRole("button", { name: "Overview", exact: true }).click();
      await expect(page.getByTestId("replay-stage")).toHaveAttribute(
        "data-camera-mode",
        "overview",
      );
    }
  });
}

test("route picker is above live Replay and can select a route", async ({
  page,
}) => {
  await installGoogleReplay(page, "ready");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/replay/14736711660");
  await page.getByRole("button", { name: "Change route", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Choose a replay route" });
  await expect(dialog).toBeVisible();
  const search = dialog.getByRole("searchbox", {
    name: "Search replay routes",
  });
  await search.fill("Tokyo");
  expect(
    await search.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return (
        element ===
        document.elementFromPoint(
          bounds.x + bounds.width / 2,
          bounds.y + bounds.height / 2,
        )
      );
    }),
  ).toBe(true);
  await dialog.locator('a[href="#/replay/17665674778"]').click();
  await expect(page).toHaveURL(/replay\/17665674778$/);
  await expect(dialog).toBeHidden();
});

test("Ember Replay settings use clear labels and reachable controls on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await installGoogleReplay(page, "ready");
  await page.goto("/#/replay/14736711660");
  await page.getByRole("button", { name: "Replay settings", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Replay settings panel" });
  await expect(panel).toBeVisible();
  for (const name of ["On terrain", "On 3D surface", "Follow route", "Explore freely", "Runner", "Overview"]) {
    const control = panel.getByRole("button", { name, exact: true });
    await expect(control).toBeVisible();
    const bounds = (await control.boundingBox())!;
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
  }
  await panel.getByRole("button", { name: "Explore freely", exact: true }).click();
  await expect(page.getByTestId("replay-stage")).toHaveAttribute("data-following", "false");
  await panel.getByRole("button", { name: "Follow route", exact: true }).click();
  await expect(page.getByTestId("replay-stage")).toHaveAttribute("data-following", "true");
  await panel.getByRole("button", { name: "On terrain", exact: true }).click();
  await expect(page.getByTestId("replay-stage")).toHaveAttribute("data-grounding-mode", "ground");
});

async function setProviderStatus(page: Page, state: "ready" | "loading" | "unavailable") {
  await page.evaluate((state) => {
    (window as typeof window & {
      __GODIESEL_SET_PROVIDER_STATUS__?: (state: "ready" | "loading" | "unavailable") => void;
    }).__GODIESEL_SET_PROVIDER_STATUS__?.(state);
  }, state);
}

test("retains keyboard play intent while the provider is loading", async ({ page }) => {
  await installGoogleReplay(page, "loading");
  await page.goto("/#/replay/14023448720");
  const stage = page.getByTestId("replay-stage");
  await expect(stage).toHaveAttribute("data-state", "loading");
  await page.locator("body").press("Space");
  await expect(page.getByRole("button", { name: "Pause route" })).toBeDisabled();
  await page.waitForTimeout(220);
  await expect(page.getByTestId("google-route-progress")).toContainText("0.00 /");
  await setProviderStatus(page, "ready");
  await expect.poll(async () => Number(await page.getByLabel("Route progress").inputValue())).toBeGreaterThan(0);
  await setProviderStatus(page, "loading");
  const frozen = await page.getByLabel("Route progress").inputValue();
  await page.waitForTimeout(220);
  await expect(page.getByLabel("Route progress")).toHaveValue(frozen);
  await expect(page.getByRole("button", { name: "Pause route" })).toBeDisabled();
});

for (const width of [390, 1280]) {
  test(`preserves playback and camera command behavior at ${width}px`, async ({ page }) => {
    await installGoogleReplay(page, "ready");
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/#/replay/14023448720");
    const stage = page.getByTestId("replay-stage");
    const settings = page.getByRole("button", { name: "Replay settings", exact: true });
    await page.getByRole("button", { name: "Play route" }).click();
    await settings.click();
    await page.getByRole("button", { name: "Explore freely", exact: true }).click();
    await expect(stage).toHaveAttribute("data-following", "false");
    const start = Number(await page.getByLabel("Route progress").inputValue());
    await expect.poll(async () => Number(await page.getByLabel("Route progress").inputValue())).toBeGreaterThan(start);
    await expect(page.getByRole("button", { name: "Pause route" })).toBeVisible();
    await page.getByRole("button", { name: "Overview", exact: true }).click();
    await expect(stage).toHaveAttribute("data-camera-mode", "overview");
    await expect(stage).toHaveAttribute("data-following", "true");
    await page.getByRole("button", { name: "On terrain", exact: true }).click();
    await expect(stage).toHaveAttribute("data-grounding-mode", "ground");
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    await page.getByRole("button", { name: "Zoom out", exact: true }).click();
    await settings.click();
    for (const speed of [1, 2, 4, 0.5]) {
      await page.getByRole("button", { name: `Playback speed ${speed}x`, exact: true }).click();
    }
    await expect(page.getByRole("button", { name: "Playback speed 1x", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Pause route" }).click();
    const scrubber = page.getByLabel("Route progress");
    const maximum = Number(await scrubber.getAttribute("max"));
    await scrubber.fill(String(Math.floor(maximum)));
    await expect(page.getByRole("button", { name: "Play route" })).toBeVisible();
    await page.getByRole("button", { name: "Play route" }).click();
    await expect(page.getByRole("button", { name: "Play route" })).toBeVisible();
    await page.getByRole("button", { name: "Play route" }).click();
    await expect(page.getByRole("button", { name: "Play route" })).toBeVisible();
    await expect(scrubber).toHaveValue(String(Math.floor(maximum)));
    await settings.click();
    await page.screenshot({ path: `artifacts/state-migration/t02/commands-${width}.png` });
    await page.getByRole("button", { name: "Change route", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Choose a replay route" });
    await dialog.getByRole("searchbox").fill("Tokyo");
    await dialog.locator('a[href="#/replay/17665674778"]').click();
    await expect(stage).toHaveAttribute("data-route-slug", "17665674778");
    await expect(stage).toHaveAttribute("data-camera-mode", "auto");
    await expect(stage).toHaveAttribute("data-grounding-mode", "ground");
    await expect(stage).toHaveAttribute("data-following", "true");
    await expect(page.getByRole("button", { name: "Play route" })).toBeVisible();
    await expect(page.getByTestId("google-route-progress")).toContainText("0.00 /");
    await expect(settings).toHaveAttribute("aria-expanded", "false");
  });
}

test("renderer replacement starts a fresh native Replay session", async ({ page }) => {
  await installGoogleReplay(page, "ready");
  await page.goto("/#/replay/14023448720");
  await page.getByRole("button", { name: "Play route" }).click();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.getByRole("button", { name: "Replay settings", exact: true }).click();
  await setProviderStatus(page, "unavailable");
  await page.getByRole("button", { name: "Use Atlas replay" }).click();
  await expect(page.getByTestId("replay-stage")).toHaveAttribute("data-engine", "maplibre-atlas");
  await page.evaluate(() => { window.location.hash = "/replay/14023448720?renderer=atlas"; });
  await expect(page).toHaveURL(/renderer=atlas/);
  await page.evaluate(() => { window.location.hash = "/replay/14023448720"; });
  await expect(page.getByTestId("replay-stage")).toHaveAttribute("data-engine", "google-3d-maps");
  await expect(page.getByRole("button", { name: "Play route" })).toBeVisible();
  await expect(page.getByTestId("replay-stage")).toHaveAttribute("data-camera-mode", "auto");
  await expect(page.getByTestId("google-route-progress")).toContainText("0.00 /");
  await expect(page.getByRole("button", { name: "Replay settings", exact: true })).toHaveAttribute("aria-expanded", "false");
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
]) {
  test(`native Replay leaves provider information accessible at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await installGoogleReplay(page, "ready");
    await page.goto("/#/replay/17654151284");
    const credits = page.getByRole("button", { name: "Provider information fixture" });
    const controls = page.getByTestId("replay-controls");
    const stage = await page.getByTestId("replay-stage").boundingBox();
    const map = await page.getByLabel(/Google photorealistic 3D view/).boundingBox();
    const creditBox = await credits.boundingBox();
    const controlsBox = await controls.boundingBox();
    expect(map!.width).toBe(stage!.width);
    expect(map!.height).toBeGreaterThan(100);
    expect(creditBox!.y + creditBox!.height).toBeLessThanOrEqual(controlsBox!.y);
    await credits.click();
    await expect(page.getByRole("button", { name: "Provider information opened" })).toBeVisible();
    await page.getByRole("button", { name: "Play route" }).click();
    await page.getByRole("button", { name: "Pause route" }).click();
    await page.getByLabel("Route progress").fill("7000");
    await expect(page.getByTestId("google-route-progress")).toContainText("7.00 /");
  });
}
