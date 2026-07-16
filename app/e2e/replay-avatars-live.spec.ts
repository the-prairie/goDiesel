import { expect, test, type Locator, type Page } from "@playwright/test";
import { PNG } from "pngjs";

const liveEnabled = process.env.GODIESEL_LIVE_REPLAY_AVATAR_E2E === "1";
const benchmarkEnabled =
  process.env.GODIESEL_REPLAY_AVATAR_BENCHMARK === "1";
const routeSlug = "17654151284";
const avatarPathPattern = /\/route-avatars\/.+\.lottie$/;
const avatars = [
  { id: "tempo-runner", label: "Tempo Runner" },
  { id: "summit-runner", label: "Summit Runner" },
  { id: "road-rider", label: "Road Rider" },
  { id: "gravel-rider", label: "Gravel Rider" },
] as const;

function countVisiblePixels(screenshot: Buffer) {
  const png = PNG.sync.read(screenshot);
  let visible = 0;
  const stride = Math.max(1, Math.floor((png.width * png.height) / 20_000));
  for (let pixel = 0; pixel < png.width * png.height; pixel += stride) {
    const offset = pixel * 4;
    if (
      png.data[offset + 3] > 20 &&
      png.data[offset] + png.data[offset + 1] + png.data[offset + 2] > 30
    ) {
      visible += 1;
    }
  }
  return visible;
}

async function waitForReplay(stage: Locator) {
  await expect(stage).toHaveAttribute("data-state", /ready|partial/, {
    timeout: 60_000,
  });
  await expect(stage).toHaveAttribute("data-avatar-assets", "ready", {
    timeout: 20_000,
  });
}

async function selectAvatar(page: Page, label: string) {
  const stage = page.getByTestId("replay-stage");
  if ((await stage.getAttribute("data-avatar")) === avatars.find(
    (avatar) => avatar.label === label,
  )?.id) {
    return;
  }
  await page
    .getByRole("button", { name: /Choose replay avatar\. Current:/ })
    .click({ force: true });
  await page.getByRole("menuitemradio", { name: label }).click({ force: true });
}

async function assertSelectedAvatar(page: Page, label: string) {
  const avatar = page.getByRole("img", {
    name: `Selected replay avatar: ${label}`,
  });
  await expect(avatar).toBeVisible();
  await expect(avatar.locator("[data-avatar-animation='ready']")).toBeVisible();
  await page.waitForTimeout(250);
  expect(countVisiblePixels(await avatar.screenshot())).toBeGreaterThan(80);
}

test.describe("live production Replay avatars", () => {
  test.skip(
    !liveEnabled,
    "Set GODIESEL_LIVE_REPLAY_AVATAR_E2E=1 to exercise live Earth Replay avatars.",
  );

  test("all avatars stay visible near, mid, and far without refetching", async ({
    page,
  }, testInfo) => {
    test.setTimeout(600_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    const avatarRequests: string[] = [];
    const failedRequests: string[] = [];
    const pageErrors: string[] = [];
    page.on("request", (request) => {
      if (avatarPathPattern.test(new URL(request.url()).pathname)) {
        avatarRequests.push(request.url());
      }
    });
    page.on("requestfailed", (request) => {
      if (avatarPathPattern.test(new URL(request.url()).pathname)) {
        failedRequests.push(request.url());
      }
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(`/#/replay/${routeSlug}`);

    const stage = page.getByTestId("replay-stage");
    const progress = page.getByLabel("Route progress");
    await waitForReplay(stage);
    expect(new Set(avatarRequests.map((url) => new URL(url).pathname)).size).toBe(4);
    expect(
      avatarRequests.every(
        (url) => new URL(url).origin === "http://127.0.0.1:8787",
      ),
    ).toBe(true);
    avatarRequests.length = 0;

    const maxProgressM = Number(await progress.getAttribute("max"));
    for (const avatar of avatars) {
      await selectAvatar(page, avatar.label);
      await expect(stage).toHaveAttribute("data-avatar", avatar.id);

      await page.getByRole("button", { name: "Zoom in to route" }).click();
      await expect(stage).toHaveAttribute("data-camera-range", "120");
      await progress.fill(String(maxProgressM * 0.15));
      await assertSelectedAvatar(page, avatar.label);
      await testInfo.attach(`${avatar.id}-near`, {
        body: await stage.screenshot(),
        contentType: "image/png",
      });

      await page.getByRole("button", { name: "Zoom out from route" }).click();
      await expect(stage).toHaveAttribute("data-camera-range", "240");
      await progress.fill(String(maxProgressM * 0.5));
      await assertSelectedAvatar(page, avatar.label);

      await page.getByRole("button", { name: "Zoom out from route" }).click();
      await page.getByRole("button", { name: "Zoom out from route" }).click();
      await expect(stage).toHaveAttribute("data-camera-range", "1400");
      await progress.fill(String(maxProgressM * 0.85));
      await assertSelectedAvatar(page, avatar.label);
      await testInfo.attach(`${avatar.id}-far`, {
        body: await stage.screenshot(),
        contentType: "image/png",
      });

      await page.getByRole("button", { name: "Zoom in to route" }).click();
      await page.getByRole("button", { name: "Zoom in to route" }).click();
    }

    expect(avatarRequests).toEqual([]);
    expect(failedRequests).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test("avatar picker and Replay controls remain clear on mobile", async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/#/replay/${routeSlug}`);
    const stage = page.getByTestId("replay-stage");
    await waitForReplay(stage);
    await page.getByRole("button", { name: "Show more controls" }).click();

    for (const avatar of avatars) {
      await selectAvatar(page, avatar.label);
      await assertSelectedAvatar(page, avatar.label);
    }

    const contextBox = await page.getByTestId("replay-context").boundingBox();
    const controlsBox = await page.getByTestId("replay-controls").boundingBox();
    expect((contextBox?.y ?? 0) + (contextBox?.height ?? 0)).toBeLessThan(
      controlsBox?.y ?? 0,
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    await testInfo.attach("production-avatars-mobile", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  });
});

test.describe("production Replay avatar lifecycle", () => {
  test.skip(
    !benchmarkEnabled,
    "Set GODIESEL_REPLAY_AVATAR_BENCHMARK=1 to run the five-minute benchmark.",
  );

  test("runs Replay for five minutes and tears down cleanly", async ({
    page,
  }) => {
    test.setTimeout(420_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    const pageErrors: string[] = [];
    const failedRequests: string[] = [];
    const lateAvatarRequests: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("requestfailed", (request) => failedRequests.push(request.url()));
    await page.addInitScript(() => {
      const replayWindow = window as typeof window & {
        __GODIESEL_REPLAY_ENGINE_FACTORY__?: () => {
          mount(options: {
            container: HTMLElement;
            avatarElement: HTMLElement;
            onStatus(status: {
              state: "ready";
              title: string;
              message: string;
            }): void;
          }): Promise<void>;
          setPose(pose: { progressM: number }): void;
          destroy(): void;
        };
      };
      replayWindow.__GODIESEL_REPLAY_ENGINE_FACTORY__ = () => {
        let container: HTMLElement | undefined;
        return {
          async mount(options) {
            container = options.container;
            const canvas = document.createElement("canvas");
            canvas.dataset.replayCanvas = "true";
            canvas.width = 800;
            canvas.height = 600;
            options.container.append(canvas);
            options.avatarElement.style.display = "block";
            options.avatarElement.style.transform =
              "translate3d(400px, 300px, 0) translate(-50%, -74%)";
            options.onStatus({
              state: "ready",
              title: "Replay ready",
              message: "Avatar lifecycle benchmark ready.",
            });
          },
          setPose(pose) {
            if (container) {
              container.dataset.benchmarkProgress = pose.progressM.toFixed(2);
            }
          },
          destroy() {
            container?.replaceChildren();
            container = undefined;
          },
        };
      };
    });
    await page.goto(`/#/replay/${routeSlug}`);

    const stage = page.getByTestId("replay-stage");
    await waitForReplay(stage);
    page.on("request", (request) => {
      if (avatarPathPattern.test(new URL(request.url()).pathname)) {
        lateAvatarRequests.push(request.url());
      }
    });
    await expect(stage).toHaveAttribute("data-avatar", "tempo-runner");
    await page.getByRole("button", { name: /Playback speed/ }).click();
    await page.getByRole("button", { name: /Playback speed/ }).click();
    await page.getByRole("button", { name: /Playback speed/ }).click();
    await expect(stage).toHaveAttribute("data-speed", "0.5");
    await page.getByRole("button", { name: "Play route" }).click();
    const benchmarkStartedAt = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 300_000));
    expect(Date.now() - benchmarkStartedAt).toBeGreaterThanOrEqual(300_000);

    expect(lateAvatarRequests).toEqual([]);
    expect(failedRequests).toEqual([]);
    expect(pageErrors).toEqual([]);
    await page.goto("/#/routes");
    await expect(page).toHaveURL(/#\/routes$/);
    await expect(page.getByTestId("replay-stage")).toHaveCount(0);
    await expect(page.locator(".cesium-viewer")).toHaveCount(0);
  });
});
