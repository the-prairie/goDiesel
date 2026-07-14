import { expect, test, type Page } from "@playwright/test";

const routeSlug = "17654151284";

async function installDeterministicReplayEngine(page: Page) {
  await page.addInitScript(() => {
    const replayWindow = window as typeof window & {
      __replayMounts?: string[];
      __replayPoses?: number[];
      __replayDestroyCount?: number;
      __GODIESEL_REPLAY_ENGINE_FACTORY__?: () => {
        mount(options: {
          container: HTMLElement;
          route: { slug: string };
          onStatus(status: {
            state: "loading" | "ready" | "unavailable";
            title: string;
            message: string;
          }): void;
        }): Promise<void>;
        setPose(pose: { progressM: number }): void;
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
          const avatar = document.createElement("div");
          avatar.setAttribute("role", "img");
          avatar.setAttribute("aria-label", "Selected replay avatar");
          avatar.textContent = "Replay avatar";
          options.container.append(avatar);
          options.onStatus({
            state: "ready",
            title: "Earth Replay ready",
            message: "The route thread and avatar are ready to move.",
          });
        },
        setPose(pose) {
          replayWindow.__replayPoses?.push(pose.progressM);
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
  await expect(page.getByRole("img", { name: "Selected replay avatar" })).toBeVisible();
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
      (window as typeof window & { __replayPoses?: number[] }).__replayPoses?.length ?? 0,
  );
  await page.waitForTimeout(250);
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __replayPoses?: number[] }).__replayPoses?.length ??
        0,
    ),
  ).toBe(poseCountAfterDestroy);
});
