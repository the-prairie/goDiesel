import { expect, test, type Page } from "@playwright/test";

const routeSlug = "17654151284";

async function installReplayStatusEngines(
  page: Page,
  earthState: "partial" | "unavailable",
) {
  await page.addInitScript((state) => {
    const replayWindow = window as typeof window & {
      __replayModes?: string[];
      __replayDestroyCount?: number;
      __GODIESEL_REPLAY_ENGINE_FACTORY__?: (mode: "earth" | "atlas") => {
        mount(options: {
          avatarElement: HTMLElement;
          onStatus(status: {
            state: "loading" | "ready" | "partial" | "unavailable";
            title: string;
            message: string;
          }): void;
        }): Promise<void>;
        setPose(): void;
        destroy(): void;
      };
    };
    replayWindow.__replayModes = [];
    replayWindow.__replayDestroyCount = 0;
    replayWindow.__GODIESEL_REPLAY_ENGINE_FACTORY__ = (mode) => ({
      async mount(options) {
        replayWindow.__replayModes?.push(mode);
        options.avatarElement.style.display = "block";
        if (mode === "atlas") {
          options.onStatus({
            state: "ready",
            title: "Atlas replay ready",
            message: "Fallback ready.",
          });
          return;
        }
        options.onStatus(
          state === "partial"
            ? {
                state: "partial",
                title: "3D tiles partially unavailable",
                message: "Some route tiles have gaps.",
              }
            : {
                state: "unavailable",
                title: "Photorealistic world unavailable",
                message: "Google 3D tiles could not load for this route.",
              },
        );
      },
      setPose() {},
      destroy() {
        replayWindow.__replayDestroyCount =
          (replayWindow.__replayDestroyCount ?? 0) + 1;
      },
    });
  }, earthState);
}

async function installUnavailableEarthWithRealAtlas(page: Page) {
  await page.addInitScript(() => {
    const replayWindow = window as typeof window & {
      __GODIESEL_REPLAY_ENGINE_FACTORY__?: (mode: "earth" | "atlas") =>
        | {
            mount(options: {
              onStatus(status: {
                state: "unavailable";
                title: string;
                message: string;
              }): void;
            }): Promise<void>;
            setPose(): void;
            destroy(): void;
          }
        | undefined;
    };
    replayWindow.__GODIESEL_REPLAY_ENGINE_FACTORY__ = (mode) => {
      if (mode === "atlas") return undefined;
      return {
        async mount(options) {
          options.onStatus({
            state: "unavailable",
            title: "Photorealistic world unavailable",
            message: "Simulated Earth failure for the real Atlas adapter.",
          });
        },
        setPose() {},
        destroy() {},
      };
    };
  });
}

async function installDeterministicReplayEngine(page: Page) {
  await page.addInitScript(() => {
    const replayWindow = window as typeof window & {
      __replayMounts?: string[];
      __replayPoses?: Array<{
        progressM: number;
        following: boolean;
        cameraRangeM: number;
      }>;
      __replayDestroyCount?: number;
      __GODIESEL_REPLAY_ENGINE_FACTORY__?: () => {
        mount(options: {
          container: HTMLElement;
          avatarElement: HTMLElement;
          route: { slug: string };
          onStatus(status: {
            state: "loading" | "ready" | "partial" | "unavailable";
            title: string;
            message: string;
          }): void;
        }): Promise<void>;
        setPose(pose: {
          progressM: number;
          following: boolean;
          cameraRangeM: number;
        }): void;
        destroy(): void;
      };
    };
    replayWindow.__replayMounts = [];
    replayWindow.__replayPoses = [];
    replayWindow.__replayDestroyCount = 0;
    replayWindow.__GODIESEL_REPLAY_ENGINE_FACTORY__ = () => {
      let container: HTMLElement | undefined;
      return {
        async mount(options) {
          container = options.container;
          replayWindow.__replayMounts?.push(options.route.slug);
          options.onStatus({
            state: "loading",
            title: "Building your route world",
            message: "Loading deterministic Earth tiles.",
          });
          const canvas = document.createElement("canvas");
          canvas.width = 800;
          canvas.height = 600;
          canvas.dataset.replayCanvas = "true";
          options.container.append(canvas);
          const routeThread = document.createElement("div");
          routeThread.dataset.testid = "route-thread";
          routeThread.textContent = "Visible route thread";
          options.container.append(routeThread);
          options.avatarElement.style.display = "block";
          options.avatarElement.style.transform =
            "translate3d(400px, 300px, 0) translate(-50%, -74%)";
          options.onStatus({
            state: "ready",
            title: "Earth Replay ready",
            message: "The route thread and avatar are ready to move.",
          });
        },
        setPose(pose) {
          replayWindow.__replayPoses?.push(pose);
          if (container) container.dataset.poseProgress = pose.progressM.toFixed(2);
        },
        destroy() {
          replayWindow.__replayDestroyCount =
            (replayWindow.__replayDestroyCount ?? 0) + 1;
          container?.replaceChildren();
          container = undefined;
        },
      };
    };
  });
}

test("bundled React Replay mounts, plays, pauses, and cleans up", async ({ page }) => {
  await installDeterministicReplayEngine(page);
  await page.goto(`/#/replay/${routeSlug}`);

  const replay = page.getByTestId("replay-stage");
  await expect(replay).toHaveAttribute("data-engine", "cesium-bundled");
  await expect(replay).toHaveAttribute("data-state", "ready");
  await expect(page.getByRole("heading", { name: "Kyoto, Japan" })).toBeVisible();
  await expect(replay.locator("canvas[data-replay-canvas='true']")).toHaveCount(1);
  await expect(page.getByTestId("route-thread")).toBeVisible();
  const stageBox = await replay.boundingBox();
  const worldBox = await replay
    .getByLabel("Earth Replay world")
    .boundingBox();
  expect(stageBox?.height).toBeGreaterThan(600);
  expect(worldBox?.height).toBe(stageBox?.height);
  await expect(
    page.getByRole("img", { name: "Selected replay avatar: Run Rex" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as typeof window & { __replayMounts?: string[] }).__replayMounts,
      ),
    )
    .toEqual([routeSlug]);

  const initialProgress = Number(await replay.getAttribute("data-progress"));
  await page.getByRole("button", { name: "Play route" }).click();
  await expect
    .poll(async () => Number(await replay.getAttribute("data-progress")))
    .toBeGreaterThan(initialProgress);

  await page.getByRole("button", { name: "Pause route" }).click();
  await page.waitForTimeout(150);
  const pausedProgress = await replay.getAttribute("data-progress");
  const pausedPoseCount = await page.evaluate(
    () =>
      (window as typeof window & { __replayPoses?: unknown[] }).__replayPoses?.length ?? 0,
  );
  await page.waitForTimeout(400);
  await expect(replay).toHaveAttribute("data-progress", pausedProgress ?? "");
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __replayPoses?: unknown[] }).__replayPoses?.length ??
        0,
    ),
  ).toBe(pausedPoseCount);

  await page.getByRole("link", { name: "Routes", exact: true }).click();
  await expect(page).toHaveURL(/#\/routes$/);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as typeof window & { __replayDestroyCount?: number })
          .__replayDestroyCount,
      ),
    )
    .toBe(1);
  const poseCountAfterDestroy = await page.evaluate(
    () =>
      (window as typeof window & { __replayPoses?: unknown[] }).__replayPoses?.length ?? 0,
  );
  await page.waitForTimeout(250);
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __replayPoses?: unknown[] }).__replayPoses?.length ??
        0,
    ),
  ).toBe(poseCountAfterDestroy);
});

test("Replay controls stay synchronized and avatar choice persists", async ({ page }) => {
  await installDeterministicReplayEngine(page);
  await page.goto(`/#/replay/${routeSlug}`);

  const replay = page.getByTestId("replay-stage");
  await expect(replay).toHaveAttribute("data-state", "ready");

  await page.getByLabel("Route progress").fill("10000");
  await expect(replay).toHaveAttribute("data-progress", "10000.00");

  await page.getByRole("button", { name: "Playback speed 1x" }).click();
  await expect(replay).toHaveAttribute("data-speed", "2");

  await page.getByRole("button", { name: "Release camera" }).click();
  await expect(replay).toHaveAttribute("data-following", "false");
  await expect(page.getByRole("button", { name: "Follow route" })).toBeVisible();
  await page.getByRole("button", { name: "Follow route" }).click();
  await expect(replay).toHaveAttribute("data-following", "true");

  await page.getByRole("button", { name: "Zoom out from route" }).click();
  await expect(replay).toHaveAttribute("data-camera-range", "720");

  await page
    .getByRole("button", { name: "Choose replay avatar. Current: Run Rex" })
    .click();
  await page.getByRole("menuitemradio", { name: "Nyan Cat" }).click();
  await expect(replay).toHaveAttribute("data-avatar", "nyan-cat");
  await expect(
    page.getByRole("img", { name: "Selected replay avatar: Nyan Cat" }),
  ).toBeVisible();

  await page.reload();
  await expect(replay).toHaveAttribute("data-state", "ready");
  await expect(replay).toHaveAttribute("data-avatar", "nyan-cat");
});

test("city and mountain Replay controls remain usable on desktop and mobile", async ({
  page,
}) => {
  await installDeterministicReplayEngine(page);
  for (const route of [routeSlug, "13358070690"]) {
    for (const viewport of [
      { width: 1440, height: 1000 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto(`/#/replay/${route}`);
      const replay = page.getByTestId("replay-stage");
      await expect(replay).toHaveAttribute("data-state", "ready");
      await expect(page.getByTestId("replay-context")).toBeVisible();
      await expect(page.getByTestId("replay-controls")).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(viewport.width);

      const contextBox = await page.getByTestId("replay-context").boundingBox();
      const controlsBox = await page.getByTestId("replay-controls").boundingBox();
      expect(contextBox).not.toBeNull();
      expect(controlsBox).not.toBeNull();
      expect((contextBox?.y ?? 0) + (contextBox?.height ?? 0)).toBeLessThan(
        controlsBox?.y ?? 0,
      );

      await page
        .getByRole("button", { name: /Choose replay avatar\. Current:/ })
        .click();
      const menuBox = await page.getByTestId("avatar-menu").boundingBox();
      expect(menuBox).not.toBeNull();
      expect(menuBox?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect((menuBox?.x ?? 0) + (menuBox?.width ?? 0)).toBeLessThanOrEqual(
        viewport.width,
      );
      expect(menuBox?.y ?? -1).toBeGreaterThanOrEqual(0);
      expect((menuBox?.y ?? 0) + (menuBox?.height ?? 0)).toBeLessThanOrEqual(
        viewport.height,
      );
      await page.getByRole("menuitemradio", { name: "Run Rex" }).click();
    }
  }
});

test("city, mountain, short, and long routes switch without stale Replay state", async ({
  page,
}) => {
  await installDeterministicReplayEngine(page);
  const representativeRoutes = [
    "14130772463", // short
    routeSlug, // city
    "13358070690", // mountain
    "9845102380", // long
  ];
  await page.goto(`/#/replay/${representativeRoutes[0]}`);
  const replay = page.getByTestId("replay-stage");
  await expect(replay).toHaveAttribute("data-state", "ready");
  await page.getByLabel("Route progress").fill("2000");
  await expect(replay).toHaveAttribute("data-progress", "2000.00");

  for (const [index, slug] of representativeRoutes.slice(1).entries()) {
    await page.evaluate((nextSlug) => {
      window.location.hash = `#/replay/${nextSlug}`;
    }, slug);
    await expect(replay).toHaveAttribute("data-route-slug", slug);
    await expect(replay).toHaveAttribute("data-state", "ready");
    await expect(replay).toHaveAttribute("data-progress", "0.00");
    await expect(replay.locator("canvas[data-replay-canvas='true']")).toHaveCount(1);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as typeof window & { __replayDestroyCount?: number })
              .__replayDestroyCount,
        ),
      )
      .toBe(index + 1);
  }

  await expect
    .poll(() =>
      page.evaluate(
        () => (window as typeof window & { __replayMounts?: string[] }).__replayMounts,
      ),
    )
    .toEqual(representativeRoutes);
});

for (const earthState of ["partial", "unavailable"] as const) {
  test(`Earth ${earthState} state switches cleanly to Atlas replay`, async ({ page }) => {
    await installReplayStatusEngines(page, earthState);
    await page.goto(`/#/replay/${routeSlug}`);

    const replay = page.getByTestId("replay-stage");
    await expect(replay).toHaveAttribute("data-state", earthState);
    await expect(page.getByText("3D tiles partially unavailable")).toHaveCount(
      earthState === "partial" ? 1 : 0,
    );
    if (earthState === "partial") {
      await expect(page.getByRole("button", { name: "Play route" })).toBeEnabled();
    }
    await page.getByRole("button", { name: "Use Atlas replay" }).click();
    await expect(replay).toHaveAttribute("data-engine", "maplibre-atlas");
    await expect(replay).toHaveAttribute("data-state", "ready");
    await expect(page.getByText("Atlas Replay", { exact: true })).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as typeof window & { __replayModes?: string[] }).__replayModes,
        ),
      )
      .toEqual(["earth", "atlas"]);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as typeof window & { __replayDestroyCount?: number })
              .__replayDestroyCount,
        ),
      )
      .toBe(1);

    await page.evaluate(() => {
      window.location.hash = "#/replay/13358070690";
    });
    await expect(replay).toHaveAttribute("data-route-slug", "13358070690");
    await expect(replay).toHaveAttribute("data-engine", "cesium-bundled");
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as typeof window & { __replayModes?: string[] }).__replayModes,
        ),
      )
      .toEqual(["earth", "atlas", "earth"]);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as typeof window & { __replayDestroyCount?: number })
              .__replayDestroyCount,
        ),
      )
      .toBe(2);
  });
}

test("real Atlas adapter fills the stage and advances the route", async ({ page }) => {
  await installUnavailableEarthWithRealAtlas(page);
  await page.goto(`/#/replay/${routeSlug}`);
  await page.getByRole("button", { name: "Use Atlas replay" }).click();

  const replay = page.getByTestId("replay-stage");
  await expect(replay).toHaveAttribute("data-engine", "maplibre-atlas");
  await expect(replay).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  await expect(page.getByRole("region", { name: "Atlas Replay" })).toBeVisible();
  await expect(page.getByLabel("Atlas Replay map").locator(".maplibregl-canvas")).toBeVisible();
  await expect(page.getByRole("button", { name: "Try Earth replay" })).toBeVisible();

  const stageBox = await replay.boundingBox();
  const mapBox = await page.getByLabel("Atlas Replay map").boundingBox();
  expect(mapBox?.width).toBe(stageBox?.width);
  expect(mapBox?.height).toBe(stageBox?.height);
  const initialProgress = Number(await replay.getAttribute("data-progress"));
  await page.getByRole("button", { name: "Play route" }).click();
  await expect
    .poll(async () => Number(await replay.getAttribute("data-progress")))
    .toBeGreaterThan(initialProgress);
  await expect(
    page.getByRole("img", { name: /Selected replay avatar:/ }),
  ).toBeVisible();
});

test("missing Replay geometry remains intentional and navigable", async ({ page }) => {
  await page.route(`**/data/routes/${routeSlug}.json`, async (request) => {
    const response = await request.fetch();
    const body = await response.json();
    body.route = [];
    await request.fulfill({ response, json: body });
  });
  await page.goto(`/#/replay/${routeSlug}`);

  await expect(page.getByRole("alert")).toContainText("Route geometry unavailable");
  await expect(page.getByRole("button", { name: "Use Atlas replay" })).toBeVisible();
  await page.getByRole("link", { name: "Return to route guide" }).click();
  await expect(page).toHaveURL(new RegExp(`#\/routes\/${routeSlug}$`));
});
