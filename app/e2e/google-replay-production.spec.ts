import { expect, test, type Page } from "@playwright/test";

async function installGoogleReplay(page: Page, state: "ready" | "unavailable") {
  await page.addInitScript((providerState) => {
    const replayWindow = window as typeof window & {
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
            state: "ready" | "unavailable";
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
        container.replaceChildren(canvas);
        onStatus({ state: "ready", message: "Google 3D fixture ready." });
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

test("presents production Replay as an immersive Story Flight", async ({
  page,
}) => {
  await installGoogleReplay(page, "ready");
  await page.goto("/#/replay/14130782031");

  const replay = page.getByTestId("replay-stage");
  await expect(replay).toHaveAttribute("data-replay-shell", "story-flight");
  await expect(page.getByTestId("atlas-spine")).toHaveCount(0);
  await expect(page.getByTestId("atlas-spine-mobile")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "the final boss", exact: true }),
  ).toBeVisible();

  const chapters = page.getByRole("navigation", { name: "Replay chapters" });
  await expect(chapters).toBeVisible();
  await expect(
    chapters.getByRole("button", { name: /hardest rise/i }),
  ).toBeVisible();
  await expect(
    chapters.getByRole("button", { name: /high point/i }),
  ).toBeVisible();
  await expect(
    chapters.getByRole("button", { name: /origin/i }),
  ).toHaveCSS("left", "0px");

  const progress = page.getByTestId("google-route-progress");
  await chapters.getByRole("button", { name: /high point/i }).click();
  await expect
    .poll(async () => Number((await progress.textContent())?.split(" ")[0]))
    .toBeGreaterThan(0);
  await expect(
    page.getByRole("button", { name: "Play route" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Change route" }),
  ).toBeVisible();
});

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
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/replay/14023448720");

  await expect(page.getByRole("alert")).toContainText("3D world unavailable");
  await page.getByRole("button", { name: "Use Atlas replay" }).click();

  const replay = page.getByTestId("replay-stage");
  await expect(replay).toHaveAttribute("data-engine", "maplibre-atlas");
  await expect(replay).toHaveAttribute("data-state", "ready");
  await expect(page.locator('[data-renderer="atlas-fallback"]')).toBeVisible();
  const fallbackBox = await replay.boundingBox();
  expect(fallbackBox?.height).toBe(844);
  expect(fallbackBox?.y).toBe(0);
});

test("wraps a long personal activity title without colliding on a phone", async ({
  page,
}) => {
  await installGoogleReplay(page, "ready");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/replay/14080158961");

  const title = page.getByRole("heading", {
    name: /DONT EVER, FOR ANY REASON/i,
  });
  const chapter = page.getByTestId("replay-active-chapter");
  await expect(title).toBeVisible();
  const titleBox = await title.boundingBox();
  const chapterBox = await chapter.boundingBox();
  expect((titleBox?.y ?? 0) + (titleBox?.height ?? 0)).toBeLessThanOrEqual(
    chapterBox?.y ?? 0,
  );
  await expect(title).not.toHaveCSS("text-overflow", "ellipsis");
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
  await page.waitForTimeout(2_000);
  await page.getByTestId("replay-stage").dispatchEvent("pointermove");
  await page.waitForTimeout(900);
  await expect(page.getByTestId("replay-stage")).toHaveAttribute(
    "data-hud-state",
    "expanded",
  );
  await expect(page.getByTestId("replay-stage")).toHaveAttribute(
    "data-hud-state",
    "hidden",
    { timeout: 1_500 },
  );
  await page.getByTestId("replay-stage").dispatchEvent("pointermove");
  await expect(page.getByTestId("replay-stage")).toHaveAttribute(
    "data-hud-state",
    "expanded",
  );
  await expect(page.getByTestId("replay-stage")).toHaveAttribute(
    "data-hud-state",
    "hidden",
    { timeout: 5_000 },
  );
});

test("keeps reduced-motion playback on a static overview edit", async ({
  page,
}) => {
  await installGoogleReplay(page, "ready");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#/replay/14023448720");

  const replay = page.getByTestId("replay-stage");
  await expect(replay).toHaveAttribute("data-reduced-motion", "true");
  await expect(replay).toHaveAttribute("data-directed-camera", "overview");
  await page.evaluate(() => {
    const replayWindow = window as typeof window & {
      __GODIESEL_CAMERA_CALLS__?: unknown[];
    };
    replayWindow.__GODIESEL_CAMERA_CALLS__ = [];
  });
  await page.getByRole("button", { name: "Play route" }).click();
  await expect
    .poll(async () =>
      Number(
        (await page.getByTestId("google-route-progress").textContent())?.split(
          " ",
        )[0],
      ),
    )
    .toBeGreaterThan(0);
  await expect(replay).toHaveAttribute("data-hud-state", "expanded");
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
    .toBe(0);
});

test("keeps mobile chapter controls named, touchable, and above the safe area", async ({
  page,
}) => {
  await installGoogleReplay(page, "ready");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/replay/14023448720");
  await page.addStyleTag({
    content: ":root { --safe-area-bottom: 28px !important; }",
  });

  const chapterNavigation = page.getByRole("navigation", {
    name: "Chapter stepper",
  });
  await expect(page.getByTestId("replay-stage")).toHaveAttribute(
    "data-state",
    "ready",
  );
  await expect(chapterNavigation).toBeVisible();
  const previousChapter = chapterNavigation.getByRole("button", {
    name: "Previous chapter",
  });
  const nextChapter = chapterNavigation.getByRole("button", {
    name: /^Next chapter:/,
  });
  await expect(previousChapter).toBeDisabled();
  await expect(nextChapter).toBeEnabled();
  for (const control of [previousChapter, nextChapter]) {
    const box = await control.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }

  await expect(page.getByTestId("story-flight-chapter-status")).toContainText(
    "1 of 5 · Origin",
  );
  await expect(page.getByTestId("story-flight-chapter-status")).toContainText(
    "3 route data notes",
  );
  await nextChapter.click();
  await expect(page.getByTestId("story-flight-chapter-status")).toContainText(
    "2 of 5 · High point",
  );
  await expect
    .poll(async () =>
      Number(
        (await page.getByTestId("google-route-progress").textContent())?.split(" ")[0],
      ),
    )
    .toBeGreaterThan(0);

  const controlsBox = await page.getByTestId("story-flight-controls").boundingBox();
  expect(844 - ((controlsBox?.y ?? 0) + (controlsBox?.height ?? 0))).toBeGreaterThanOrEqual(28);
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
