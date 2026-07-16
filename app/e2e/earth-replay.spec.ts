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
    page.getByRole("img", { name: "Selected replay avatar: Tempo Runner" }),
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
  await expect(replay).toHaveAttribute("data-avatar-assets", "ready");

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
    .getByRole("button", { name: "Choose replay avatar. Current: Tempo Runner" })
    .click();
  await expect(
    page.getByRole("menuitem", { name: "Evaluate avatar systems" }),
  ).toHaveAttribute("href", `#/lab/avatar-evaluation/${routeSlug}`);
  await page.getByRole("menuitemradio", { name: "Gravel Rider" }).click();
  await expect(replay).toHaveAttribute("data-avatar", "gravel-rider");
  await expect(
    page.getByRole("img", { name: "Selected replay avatar: Gravel Rider" }),
  ).toBeVisible();

  await page.evaluate(() => {
    window.location.hash = "#/replay/13358070690";
  });
  await expect(replay).toHaveAttribute("data-route-slug", "13358070690");
  await expect(replay).toHaveAttribute("data-state", "ready");
  await expect(replay).toHaveAttribute("data-avatar", "gravel-rider");
  await expect(
    page.getByRole("img", { name: "Selected replay avatar: Gravel Rider" }),
  ).toBeVisible();

  await page.reload();
  await expect(replay).toHaveAttribute("data-state", "ready");
  await expect(replay).toHaveAttribute("data-avatar", "gravel-rider");
});

test("Replay preloads every professional avatar before switching", async ({ page }) => {
  const avatarRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/route-avatars/")) {
      avatarRequests.push(new URL(request.url()).pathname);
    }
  });
  await installDeterministicReplayEngine(page);
  await page.goto(`/#/replay/${routeSlug}`);

  const replay = page.getByTestId("replay-stage");
  await expect(replay).toHaveAttribute("data-avatar-assets", "ready");
  expect(new Set(avatarRequests)).toEqual(
    new Set([
      "/route-avatars/tempo-runner.lottie",
      "/route-avatars/summit-runner.lottie",
      "/route-avatars/road-rider.lottie",
      "/route-avatars/gravel-rider.lottie",
    ]),
  );
  avatarRequests.length = 0;

  for (const [label, id] of [
    ["Summit Runner", "summit-runner"],
    ["Road Rider", "road-rider"],
    ["Gravel Rider", "gravel-rider"],
    ["Tempo Runner", "tempo-runner"],
  ] as const) {
    await page
      .getByRole("button", { name: /Choose replay avatar\. Current:/ })
      .click();
    await page.getByRole("menuitemradio", { name: label }).click();
    await expect(replay).toHaveAttribute("data-avatar", id);
    await expect(
      page.getByRole("img", { name: `Selected replay avatar: ${label}` }),
    ).toBeVisible();
  }

  expect(avatarRequests).toEqual([]);
});

test("reduced motion pins the avatar pose while Replay progresses", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installDeterministicReplayEngine(page);
  await page.goto(`/#/replay/${routeSlug}`);

  const replay = page.getByTestId("replay-stage");
  await expect(replay).toHaveAttribute("data-state", "ready");
  await expect(replay).toHaveAttribute("data-reduced-motion", "true");
  const avatarCanvas = page
    .getByRole("img", { name: "Selected replay avatar: Tempo Runner" })
    .locator("[data-avatar-frame]");
  await expect(avatarCanvas).toHaveAttribute("data-avatar-frame", /\d+/);
  const representativeFrame = await avatarCanvas.getAttribute("data-avatar-frame");

  const initialProgress = Number(await replay.getAttribute("data-progress"));
  await page.getByRole("button", { name: "Play route" }).click();
  await expect
    .poll(async () => Number(await replay.getAttribute("data-progress")))
    .toBeGreaterThan(initialProgress);
  await expect(avatarCanvas).toHaveAttribute(
    "data-avatar-frame",
    representativeFrame ?? "",
  );

  await page.getByLabel("Route progress").fill("10000");
  await expect(avatarCanvas).toHaveAttribute(
    "data-avatar-frame",
    representativeFrame ?? "",
  );
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

      if (viewport.width < 768) {
        await page.getByRole("button", { name: "Show more controls" }).click();
        await expect(page.getByTestId("replay-secondary-controls")).toBeVisible();
      }
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
      await page.getByRole("menuitemradio", { name: "Tempo Runner" }).click();
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

test("Change route searches every replay-ready route and updates the world", async ({
  page,
}) => {
  await installDeterministicReplayEngine(page);
  await page.goto(`/#/replay/${routeSlug}`);
  await expect(page.getByTestId("replay-stage")).toHaveAttribute("data-state", "ready");

  await page.getByRole("button", { name: "Change route" }).click();
  const chooser = page.getByRole("dialog", { name: "Choose a replay route" });
  await expect(chooser).toBeVisible();
  await expect(chooser.getByRole("region", { name: "Featured shortlist" })).toBeVisible();
  await expect(
    chooser.getByText("Routes selected for their strongest Earth Replay experience."),
  ).toBeVisible();
  const routeTotal = Number(
    (await chooser.getByText(/Search all \d+ routes ready for Replay\./).textContent())?.match(
      /\d+/,
    )?.[0],
  );
  expect(routeTotal).toBeGreaterThan(12);
  await expect(chooser.getByRole("link")).toHaveCount(routeTotal);

  await chooser.getByRole("searchbox", { name: "Search replay routes" }).fill("Victoria");
  await expect(chooser.getByRole("status")).toHaveText(
    /\d+ replay routes match your search\./,
  );
  await expect(chooser.getByRole("region", { name: /\d+ matches/ })).toBeVisible();
  await expect(chooser.getByRole("region", { name: "Featured shortlist" })).toHaveCount(0);
  const destination = chooser.locator("a[href$='/replay/5650407638']");
  await expect(destination).toContainText("Victoria, BC");
  await expect(destination).toContainText("Ride · 84.6 km");
  await expect(destination).toContainText("Replay ready");
  await destination.click();

  await expect(page).toHaveURL(/#\/replay\/5650407638$/);
  await expect(page.getByTestId("replay-stage")).toHaveAttribute(
    "data-route-slug",
    "5650407638",
  );
  await expect(page.getByRole("heading", { name: "Victoria, BC" })).toBeVisible();

  await page.getByRole("button", { name: "Change route" }).click();
  await expect(chooser.getByRole("searchbox", { name: "Search replay routes" })).toHaveValue(
    "",
  );
  await expect(chooser.getByRole("region", { name: "Featured shortlist" })).toBeVisible();
  await expect(chooser.getByRole("link")).toHaveCount(routeTotal);
});

test("Replay route chooser has intentional empty and mobile states", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installDeterministicReplayEngine(page);
  await page.goto(`/#/replay/${routeSlug}`);
  await page.getByRole("button", { name: "Change route" }).click();

  const chooser = page.getByRole("dialog", { name: "Choose a replay route" });
  const chooserBox = await chooser.boundingBox();
  expect(chooserBox).not.toBeNull();
  expect(chooserBox?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((chooserBox?.x ?? 0) + (chooserBox?.width ?? 0)).toBeLessThanOrEqual(390);
  await chooser.getByRole("searchbox", { name: "Search replay routes" }).fill("Atlantis");
  await expect(chooser.getByRole("status")).toHaveText(
    "0 replay routes match your search.",
  );
  await expect(chooser.getByText("No replay routes found")).toBeVisible();
  await expect(chooser.getByText("Try another place or activity.")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    390,
  );
});

for (const [device, viewport] of [
  ["desktop", { width: 1440, height: 1000 }],
  ["mobile", { width: 390, height: 844 }],
] as const) {
  test(`Replay route changes expose loading on ${device}`, async ({ page }) => {
    await installDeterministicReplayEngine(page);
    await page.route("**/data/routes/5650407638.json", async (request) => {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      await request.continue();
    });
    await page.setViewportSize(viewport);
    await page.goto(`/#/replay/${routeSlug}`);
    await page.getByRole("button", { name: "Change route" }).click();
    const chooser = page.getByRole("dialog", { name: "Choose a replay route" });
    await chooser.getByRole("searchbox", { name: "Search replay routes" }).fill("Victoria");
    await chooser.locator("a[href$='/replay/5650407638']").click();
    await expect(page.getByRole("status")).toHaveText("Loading Earth Replay.");
    await expect(page.getByTestId("replay-stage")).toHaveAttribute("data-state", "ready");
  });
}

test("Earth Replay enters Playable Earth and returns to the same route", async ({ page }) => {
  await installDeterministicReplayEngine(page);
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(`/#/replay/${routeSlug}`);
    await expect(page.getByTestId("replay-stage")).toHaveAttribute("data-state", "ready");
    await page.getByRole("link", { name: "Enter route" }).click();
    await expect(page).toHaveURL(
      new RegExp(`#\\/lab\\/playable-earth\\/${routeSlug}\\?from=replay$`),
    );
    await expect(page.getByRole("region", { name: "Playable Earth Lab" })).toBeVisible();
    await page.getByRole("link", { name: "Exit lab" }).click();
    await expect(page).toHaveURL(new RegExp(`#\\/replay\\/${routeSlug}$`));
    await expect(page.getByTestId("replay-stage")).toHaveAttribute(
      "data-route-slug",
      routeSlug,
    );
  }
});

test("Replay explains when Playable Earth is unavailable", async ({ page }) => {
  await installDeterministicReplayEngine(page);
  await page.route(`**/data/routes/${routeSlug}.json`, async (request) => {
    const response = await request.fetch();
    const body = await response.json();
    body.replay.replay_eligible = false;
    await request.fulfill({ response, json: body });
  });
  await page.goto(`/#/replay/${routeSlug}`);

  await expect(page.getByRole("link", { name: "Enter route" })).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText(
    "Playable Earth unavailable. This route needs complete recorded geometry.",
  );
});

for (const width of [320, 430]) {
  test(`mobile Replay HUD prioritizes the world at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await installDeterministicReplayEngine(page);
    await page.goto(`/#/replay/${routeSlug}`);

    const replay = page.getByTestId("replay-stage");
    const context = page.getByTestId("replay-context");
    const controls = page.getByTestId("replay-controls");
    await expect(replay).toHaveAttribute("data-state", "ready");
    await expect(context).toHaveAttribute("data-mobile-expanded", "true");
    await expect(page.getByTestId("replay-context-details")).toBeVisible();
    await expect(page.getByTestId("replay-secondary-controls")).toHaveCount(0);

    for (const label of ["Play route", "Release camera", "Show more controls"]) {
      const box = await page.getByRole("button", { name: label }).boundingBox();
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }

    await page.getByRole("button", { name: "Play route" }).click();
    await expect(context).toHaveAttribute("data-mobile-expanded", "false");
    await expect(page.getByTestId("replay-context-details")).toBeHidden();
    await expect(page.getByRole("button", { name: "Pause route" })).toBeVisible();

    const contextBox = await context.boundingBox();
    const controlsBox = await controls.boundingBox();
    expect((controlsBox?.y ?? 0) - ((contextBox?.y ?? 0) + (contextBox?.height ?? 0)))
      .toBeGreaterThan(300);

    await page.getByRole("button", { name: "Show more controls" }).click();
    const secondary = page.getByTestId("replay-secondary-controls");
    await expect(secondary).toBeVisible();
    for (const label of [
      "Zoom in to route",
      "Zoom out from route",
      "Playback speed 1x",
      "Choose replay avatar. Current: Tempo Runner",
    ]) {
      const box = await page.getByRole("button", { name: label }).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }

    await page.getByRole("button", { name: "Show route details" }).click();
    await page.getByRole("button", { name: "Change route" }).click();
    await expect(page.getByRole("dialog", { name: "Choose a replay route" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
  });
}

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
