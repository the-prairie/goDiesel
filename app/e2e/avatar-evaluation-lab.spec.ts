import { expect, test, type Page } from "@playwright/test";

const routeSlug = "17654151284";
const secondRouteSlug = "13358070690";

async function installEvaluationEngine(page: Page) {
  await page.addInitScript(() => {
    const evaluationWindow = window as typeof window & {
      __avatarLabMounts?: Array<{ system: string; route: string }>;
      __avatarLabPoses?: Array<{ progressM: number; cameraRangeM: number }>;
      __avatarLabRendererSwitches?: string[];
      __avatarLabDestroyCount?: number;
      __GODIESEL_AVATAR_EVALUATION_ENGINE_FACTORY__?: (system: string) => {
        mount(options: {
          container: HTMLElement;
          avatarElement: HTMLElement;
          route: { slug: string };
          onStatus(status: {
            state: "ready";
            title: string;
            message: string;
          }): void;
        }): Promise<void>;
        setAvatarRendering(rendering: {
          kind: "overlay" | "native-glb";
        }): Promise<"ready">;
        setPose(pose: { progressM: number; cameraRangeM: number }): void;
        destroy(): void;
      };
    };
    evaluationWindow.__avatarLabMounts = [];
    evaluationWindow.__avatarLabPoses = [];
    evaluationWindow.__avatarLabRendererSwitches = [];
    evaluationWindow.__avatarLabDestroyCount = 0;
    evaluationWindow.__GODIESEL_AVATAR_EVALUATION_ENGINE_FACTORY__ = (system) => {
      let container: HTMLElement | undefined;
      return {
        async mount(options) {
          container = options.container;
          evaluationWindow.__avatarLabMounts?.push({
            system,
            route: options.route.slug,
          });
          const canvas = document.createElement("canvas");
          canvas.width = 800;
          canvas.height = 600;
          canvas.dataset.avatarLabWorld = "true";
          const context = canvas.getContext("2d");
          if (context) {
            context.fillStyle = "#173a31";
            context.fillRect(0, 0, canvas.width, canvas.height);
            context.strokeStyle = "#00f19f";
            context.lineWidth = 14;
            context.beginPath();
            context.moveTo(40, 540);
            context.bezierCurveTo(240, 80, 520, 500, 760, 80);
            context.stroke();
          }
          options.container.append(canvas);
          options.avatarElement.style.display = "block";
          options.avatarElement.style.transform =
            "translate3d(400px, 320px, 0) translate(-50%, -74%)";
          options.onStatus({
            state: "ready",
            title: "Evaluation world ready",
            message: "Deterministic world ready.",
          });
        },
        setPose(pose) {
          evaluationWindow.__avatarLabPoses?.push(pose);
          if (container) {
            container.dataset.poseProgress = pose.progressM.toFixed(2);
            container.dataset.cameraRange = String(pose.cameraRangeM);
          }
        },
        async setAvatarRendering(rendering) {
          evaluationWindow.__avatarLabRendererSwitches?.push(rendering.kind);
          if (container) container.dataset.avatarRenderer = rendering.kind;
          return "ready";
        },
        destroy() {
          evaluationWindow.__avatarLabDestroyCount =
            (evaluationWindow.__avatarLabDestroyCount ?? 0) + 1;
          container?.replaceChildren();
          container = undefined;
        },
      };
    };
  });
}

test("avatar lab compares all renderers through one replay control surface", async ({
  page,
}) => {
  await installEvaluationEngine(page);
  await page.goto(`/#/lab/avatar-evaluation/${routeSlug}`);

  const stage = page.getByTestId("avatar-evaluation-stage");
  await expect(stage).toHaveAttribute("data-state", "ready");
  await expect(stage).toHaveAttribute("data-system", "dotlottie");
  await expect(page.getByRole("heading", { name: "Kyoto, Japan" })).toBeVisible();
  await expect(page.getByLabel("Avatar evaluation world")).toContainText("");
  await expect(stage.locator("canvas[data-avatar-lab-world='true']")).toHaveCount(1);

  const initialProgress = Number(await stage.getAttribute("data-progress"));
  await page.getByRole("button", { name: "Play avatar evaluation" }).click();
  await expect
    .poll(async () => Number(await stage.getAttribute("data-progress")))
    .toBeGreaterThan(initialProgress);
  await page.getByRole("button", { name: "Pause avatar evaluation" }).click();

  await page.getByLabel("Avatar evaluation progress").fill("5000");
  await expect(stage).toHaveAttribute("data-progress", "5000.00");
  await page.getByRole("button", { name: "Evaluation playback speed 1x" }).click();
  await expect(stage).toHaveAttribute("data-speed", "2");

  await page.getByRole("button", { name: "Far" }).click();
  await expect(stage).toHaveAttribute("data-camera-range", "1400");
  await page.getByRole("button", { name: "Near" }).click();
  await expect(stage).toHaveAttribute("data-camera-range", "120");

  await page.getByRole("tab", { name: "Native Cesium GLB" }).click();
  await expect(stage).toHaveAttribute("data-system", "cesium-glb");
  await expect(stage).toHaveAttribute("data-renderer-state", "ready");
  await expect(stage).toHaveAttribute("data-progress", "5000.00");
  await expect(stage).toHaveAttribute("data-speed", "2");
  await expect(stage).toHaveAttribute("data-camera-range", "120");
  await page.getByRole("tab", { name: "Rive Canvas Lite" }).click();
  await expect(stage).toHaveAttribute("data-system", "rive");
  await expect(stage).toHaveAttribute("data-renderer-state", /ready|error/);
  await expect(stage).toHaveAttribute("data-progress", "5000.00");
  await expect(stage).toHaveAttribute("data-speed", "2");
  await expect(stage).toHaveAttribute("data-camera-range", "120");
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __avatarLabMounts?: unknown[] })
          .__avatarLabMounts?.length ?? 0,
    ),
  ).toBe(1);
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __avatarLabDestroyCount?: number })
          .__avatarLabDestroyCount ?? 0,
    ),
  ).toBe(0);
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __avatarLabRendererSwitches?: string[] })
          .__avatarLabRendererSwitches,
    ),
  ).toEqual(["overlay", "native-glb", "overlay"]);

  await page.getByRole("button", { name: "Reduced motion" }).click();
  await expect(stage).toHaveAttribute("data-reduced-motion", "true");

  await page.getByLabel("Evaluation route").selectOption(secondRouteSlug);
  await expect(page).toHaveURL(
    new RegExp(`#/lab/avatar-evaluation/${secondRouteSlug}$`),
  );
  await expect(page.getByRole("heading", { name: "Banff/Kananaskis" })).toBeVisible();

  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as typeof window & { __avatarLabDestroyCount?: number })
          .__avatarLabDestroyCount ?? 0,
      ),
    )
    .toBe(1);
});

test("avatar lab switches and persists custom dotLottie avatars", async ({ page }) => {
  await installEvaluationEngine(page);
  await page.goto(`/#/lab/avatar-evaluation/${routeSlug}`);

  const stage = page.getByTestId("avatar-evaluation-stage");
  await expect(stage).toHaveAttribute("data-system", "dotlottie");
  await expect(stage).toHaveAttribute("data-avatar", "tempo-runner");

  const avatarSelect = page.getByLabel("Custom dotLottie avatar");
  await expect(avatarSelect).toHaveValue("tempo-runner");
  await expect(avatarSelect.locator("option")).toHaveCount(5);

  await avatarSelect.selectOption("summit-runner");
  await expect(stage).toHaveAttribute("data-avatar", "summit-runner");
  await expect(page.getByRole("img", { name: "Summit Runner route avatar" })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => window.localStorage.getItem("godiesel:replay-avatar")),
    )
    .toBe("summit-runner");

  await page.reload();
  await expect(stage).toHaveAttribute("data-avatar", "summit-runner");
  await expect(avatarSelect).toHaveValue("summit-runner");
});

test("avatar lab keeps avatar runtime requests local and cleans up on exit", async ({
  page,
}) => {
  await installEvaluationEngine(page);
  const avatarRequests: string[] = [];
  const failedAvatarResponses: Array<{ url: string; status: number }> = [];
  page.on("request", (request) => {
    const url = request.url();
    if (
      /route-avatars|avatar-lab|riveStatic|dotlottieStatic|rive\.wasm|dotlottie-player\.wasm/.test(
        url,
      )
    ) {
      avatarRequests.push(url);
    }
  });
  page.on("response", (response) => {
    if (
      /route-avatars|avatar-lab|riveStatic|dotlottieStatic|rive\.wasm|dotlottie-player\.wasm/.test(
        response.url(),
      ) &&
      !response.ok()
    ) {
      failedAvatarResponses.push({ url: response.url(), status: response.status() });
    }
  });
  await page.goto(`/#/lab/avatar-evaluation/${routeSlug}`);
  const stage = page.getByTestId("avatar-evaluation-stage");
  await expect(stage).toHaveAttribute("data-state", "ready");
  await expect
    .poll(() =>
      avatarRequests.some((url) => url.includes("/dotlottieStatic/dotlottie-player.wasm")),
    )
    .toBe(true);
  await expect
    .poll(() =>
      avatarRequests.some((url) => url.includes("/route-avatars/tempo-runner.lottie")),
    )
    .toBe(true);

  await page.getByRole("tab", { name: "Rive Canvas Lite" }).click();
  await expect(stage).toHaveAttribute("data-system", "rive");
  await expect
    .poll(() => avatarRequests.some((url) => url.includes("/avatar-lab/vehicles.riv")))
    .toBe(true);
  expect(avatarRequests.every((url) => new URL(url).origin === "http://127.0.0.1:8791"))
    .toBe(true);
  expect(failedAvatarResponses).toEqual([]);

  await page.getByRole("link", { name: "Exit avatar lab" }).click();
  await expect(page).toHaveURL(new RegExp(`#/replay/${routeSlug}$`));
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as typeof window & { __avatarLabDestroyCount?: number })
          .__avatarLabDestroyCount ?? 0,
      ),
    )
    .toBe(1);
});

for (const width of [320, 430]) {
  test(`avatar lab remains usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await installEvaluationEngine(page);
    await page.goto(`/#/lab/avatar-evaluation/${routeSlug}`);

    const stage = page.getByTestId("avatar-evaluation-stage");
    await expect(stage).toHaveAttribute("data-state", "ready");
    await expect(page.getByRole("tab", { name: "Lottie" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "GLB" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Rive" })).toBeVisible();

    for (const control of [
      page.getByRole("button", { name: "Play avatar evaluation" }),
      page.getByRole("button", { name: "Evaluation playback speed 1x" }),
      page.getByRole("button", { name: "Motion" }),
    ]) {
      const box = await control.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }

    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    const stageBox = await stage.boundingBox();
    const worldBox = await page.getByLabel("Avatar evaluation world").boundingBox();
    expect(stageBox?.height).toBeGreaterThan(700);
    expect(worldBox?.height).toBe(stageBox?.height);
  });
}
