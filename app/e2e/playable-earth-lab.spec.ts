import { expect, test, type Page } from "@playwright/test";

const routeSlug = "17654151284";
const secondRouteSlug = "17665674778";

async function installDeterministicEarthRenderer(
  page: Page,
  state: "ready" | "unavailable" = "ready",
) {
  await page.addInitScript((rendererState) => {
    const labWindow = window as typeof window & {
      __earthLabMounts?: string[];
      __earthLabDestroyCount?: number;
      __earthLabPoses?: Array<{
        progressM: number;
        lateralOffsetM: number;
        cameraHeadingDeg: number;
      }>;
      __GODIESEL_PLAYABLE_EARTH_FACTORY__?: () => {
        mount(options: {
          container: HTMLElement;
          route: {
            slug: string;
            name: string;
            route: Array<{ lat: number; lng: number }>;
          };
          onStatus(status: {
            state: "ready" | "unavailable";
            title: string;
            message: string;
          }): void;
        }): Promise<void>;
        setPose(pose: {
          progressM: number;
          lateralOffsetM: number;
          cameraHeadingDeg: number;
        }): void;
        destroy(): void;
      };
    };
    labWindow.__earthLabMounts = [];
    labWindow.__earthLabDestroyCount = 0;
    labWindow.__earthLabPoses = [];
    labWindow.__GODIESEL_PLAYABLE_EARTH_FACTORY__ = () => {
      let container: HTMLElement | undefined;
      return {
        async mount(options) {
          container = options.container;
          labWindow.__earthLabMounts?.push(options.route.slug);
          if (rendererState === "unavailable") {
            options.onStatus({
              state: "unavailable",
              title: "Photorealistic world unavailable",
              message: "The deterministic renderer simulated a tile failure.",
            });
            return;
          }

          const canvas = document.createElement("canvas");
          canvas.width = 800;
          canvas.height = 500;
          canvas.setAttribute("aria-label", "Deterministic photorealistic world");
          canvas.dataset.routeSlug = options.route.slug;
          const context = canvas.getContext("2d");
          if (context) {
            context.fillStyle = "#08202a";
            context.fillRect(0, 0, canvas.width, canvas.height);
            context.strokeStyle = "#00f19f";
            context.lineWidth = 8;
            context.beginPath();
            options.route.route.slice(0, 80).forEach((_, index, points) => {
              const x = 60 + (index / Math.max(1, points.length - 1)) * 680;
              const y = 250 + Math.sin(index / 7) * 90;
              if (index === 0) context.moveTo(x, y);
              else context.lineTo(x, y);
            });
            context.stroke();
            context.fillStyle = "#ffffff";
            context.beginPath();
            context.arc(60, 250, 12, 0, Math.PI * 2);
            context.fill();
          }
          options.container.appendChild(canvas);
          options.onStatus({
            state: "ready",
            title: "Playable Earth ready",
            message: "Route thread and starting position are visible.",
          });
        },
        setPose(pose) {
          labWindow.__earthLabPoses?.push({
            progressM: pose.progressM,
            lateralOffsetM: pose.lateralOffsetM,
            cameraHeadingDeg: pose.cameraHeadingDeg,
          });
          const canvas = container?.querySelector("canvas");
          if (canvas) canvas.dataset.progressM = pose.progressM.toFixed(2);
        },
        destroy() {
          labWindow.__earthLabDestroyCount =
            (labWindow.__earthLabDestroyCount ?? 0) + 1;
          container?.replaceChildren();
        },
      };
    };
  }, state);
}

test("canonical completed route opens the isolated lab and exits cleanly", async ({
  page,
}) => {
  await installDeterministicEarthRenderer(page);
  await page.goto(`/#/lab/playable-earth/${routeSlug}`);

  const lab = page.getByRole("region", { name: "Playable Earth Lab" });
  await expect(lab).toHaveAttribute("data-state", "ready");
  await expect(lab).toHaveAttribute("data-route-slug", routeSlug);
  await expect(page.getByRole("heading", { name: "Kyoto, Japan" })).toBeVisible();
  await expect(page.getByText("Route thread ready")).toBeVisible();
  await expect(
    page.locator('canvas[aria-label="Deterministic photorealistic world"]'),
  ).toHaveAttribute("data-route-slug", routeSlug);
  await expect(page.getByRole("link", { name: "Replay", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await page.getByRole("link", { name: "Exit lab" }).click();
  await expect(page).toHaveURL(new RegExp(`#\/routes\/${routeSlug}$`));
  await expect(page.getByRole("heading", { name: "Kyoto, Japan" })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { __earthLabDestroyCount?: number })
            .__earthLabDestroyCount,
      ),
    )
    .toBe(1);
});

test("changing lab routes destroys the previous viewer and resets route state", async ({
  page,
}) => {
  await installDeterministicEarthRenderer(page);
  await page.goto(`/#/lab/playable-earth/${routeSlug}`);
  await expect(page.getByRole("region", { name: "Playable Earth Lab" })).toHaveAttribute(
    "data-state",
    "ready",
  );

  await page.evaluate((slug) => {
    window.location.hash = `#/lab/playable-earth/${slug}`;
  }, secondRouteSlug);

  const lab = page.getByRole("region", { name: "Playable Earth Lab" });
  await expect(lab).toHaveAttribute("data-route-slug", secondRouteSlug);
  await expect(page.getByRole("heading", { name: "Tokyo, Japan" })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => ({
        mounts: (window as typeof window & { __earthLabMounts?: string[] })
          .__earthLabMounts,
        destroys: (window as typeof window & { __earthLabDestroyCount?: number })
          .__earthLabDestroyCount,
      })),
    )
    .toEqual({ mounts: [routeSlug, secondRouteSlug], destroys: 1 });
});

test("tile failure is legible and preserves an escape path", async ({ page }) => {
  await installDeterministicEarthRenderer(page, "unavailable");
  await page.goto(`/#/lab/playable-earth/${routeSlug}`);

  await expect(page.getByRole("alert")).toContainText(
    "Photorealistic world unavailable",
  );
  await expect(page.getByText(/simulated a tile failure/i)).toBeVisible();
  await page.getByRole("link", { name: "Return to route" }).click();
  await expect(page).toHaveURL(new RegExp(`#\/routes\/${routeSlug}$`));
});

test("unknown and malformed lab routes show the canonical unavailable state", async ({
  page,
}) => {
  await installDeterministicEarthRenderer(page);
  for (const path of ["not-a-route", "%"]) {
    await page.goto(`/#/lab/playable-earth/${path}`);
    await expect(
      page.getByRole("heading", { name: "This route could not be found." }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Browse routes" })).toBeVisible();
  }
});

test("guided control preserves progress and constrains steering and camera look", async ({
  page,
}) => {
  await installDeterministicEarthRenderer(page);
  await page.goto(`/#/lab/playable-earth/${routeSlug}`);
  const lab = page.getByRole("region", { name: "Playable Earth Lab" });
  const progress = page.getByRole("slider", { name: "Route progress" });

  await expect(lab).toHaveAttribute("data-state", "ready");
  await expect(lab).toHaveAttribute("data-control-mode", "replay");
  await page.getByRole("button", { name: "Take control" }).click();
  await expect(lab).toHaveAttribute("data-control-mode", "guided");
  await page.getByRole("button", { name: "Play route" }).click();
  await expect.poll(async () => Number(await progress.inputValue())).toBeGreaterThan(20);
  await page.getByRole("button", { name: "Pause route" }).click();
  const preservedProgress = Number(await progress.inputValue());

  const steerRight = page.getByRole("button", { name: "Steer right" });
  await steerRight.hover();
  await page.mouse.down();
  await page.waitForTimeout(2_000);
  await page.mouse.up();
  const lateralOffset = Number(await lab.getAttribute("data-lateral-offset"));
  expect(lateralOffset).toBeGreaterThan(10);
  expect(lateralOffset).toBeLessThanOrEqual(15);

  const lookRight = page.getByRole("button", { name: "Look right" });
  await lookRight.hover();
  await page.mouse.down();
  await page.waitForTimeout(1_000);
  await page.mouse.up();
  const cameraYaw = Number(await lab.getAttribute("data-camera-yaw"));
  expect(cameraYaw).toBeGreaterThan(20);
  expect(cameraYaw).toBeLessThanOrEqual(65);

  await page.getByRole("button", { name: "Resume automatic replay" }).click();
  await expect(lab).toHaveAttribute("data-control-mode", "replay");
  expect(Number(await progress.inputValue())).toBeCloseTo(preservedProgress, 0);
});

test("keyboard controls change mode, playback, pace, steering, and look", async ({
  page,
}) => {
  await installDeterministicEarthRenderer(page);
  await page.goto(`/#/lab/playable-earth/${routeSlug}`);
  const lab = page.getByRole("region", { name: "Playable Earth Lab" });

  await expect(lab).toHaveAttribute("data-state", "ready");
  await lab.click({ position: { x: 500, y: 300 } });
  await page.keyboard.press("t");
  await expect(lab).toHaveAttribute("data-control-mode", "guided");
  await page.keyboard.press("w");
  await expect(page.getByRole("button", { name: "Playback speed 2x" })).toBeVisible();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Pause route" })).toBeVisible();

  await page.keyboard.down("d");
  await page.keyboard.down("e");
  await page.waitForTimeout(700);
  await page.keyboard.up("d");
  await page.keyboard.up("e");
  expect(Number(await lab.getAttribute("data-lateral-offset"))).toBeGreaterThan(2);
  expect(Number(await lab.getAttribute("data-camera-yaw"))).toBeGreaterThan(10);

  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Play route" })).toBeVisible();
});
