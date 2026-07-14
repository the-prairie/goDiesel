import { expect, test, type Page } from "@playwright/test";

const routeSlug = "17654151284";

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
            state: "loading" | "ready" | "unavailable";
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

  const replay = page.getByRole("region", { name: "Earth Replay" });
  await expect(replay).toHaveAttribute("data-engine", "cesium-bundled");
  await expect(replay).toHaveAttribute("data-state", "ready");
  await expect(page.getByRole("heading", { name: "Kyoto, Japan" })).toBeVisible();
  await expect(replay.locator("canvas[data-replay-canvas='true']")).toHaveCount(1);
  await expect(page.getByTestId("route-thread")).toBeVisible();
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
  await page.waitForTimeout(400);
  await expect(replay).toHaveAttribute("data-progress", pausedProgress ?? "");

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

  const replay = page.getByRole("region", { name: "Earth Replay" });
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
      const replay = page.getByRole("region", { name: "Earth Replay" });
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
