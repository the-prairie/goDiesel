import { expect, test, type Page } from "@playwright/test";

const routeSlug = "17654151284";
const secondRouteSlug = "17665674778";

async function installDeterministicEarthRenderer(
  page: Page,
  state: "ready" | "unavailable" = "ready",
  grounding: "fallback" | "sampled" = "fallback",
) {
  await page.addInitScript(({ rendererState, groundingState }) => {
    const labWindow = window as typeof window & {
      __earthLabMounts?: string[];
      __earthLabDestroyCount?: number;
      __earthLabPoses?: Array<{
        progressM: number;
        lateralOffsetM: number;
        cameraHeadingDeg: number;
        cameraRangeM: number;
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
          onGroundingChange?(debug: {
            source: "fallback" | "sampled";
            reason: "recorded" | "sampled";
            offsetM?: number;
          }): void;
        }): Promise<void>;
        setPose(pose: {
          progressM: number;
          lateralOffsetM: number;
          cameraHeadingDeg: number;
          cameraRangeM: number;
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
          options.onGroundingChange?.(
            groundingState === "sampled"
              ? { source: "sampled", reason: "sampled", offsetM: 8.5 }
              : { source: "fallback", reason: "recorded" },
          );
        },
        setPose(pose) {
          labWindow.__earthLabPoses?.push({
            progressM: pose.progressM,
            lateralOffsetM: pose.lateralOffsetM,
            cameraHeadingDeg: pose.cameraHeadingDeg,
            cameraRangeM: pose.cameraRangeM,
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
  }, { rendererState: state, groundingState: grounding });
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

test("direct navigation cannot bypass Playable Earth eligibility", async ({ page }) => {
  await page.route(`**/data/routes/${routeSlug}.json`, async (request) => {
    const response = await request.fetch();
    const body = await response.json();
    body.replay.replay_eligible = false;
    await request.fulfill({ response, json: body });
  });
  await page.goto(`/#/lab/playable-earth/${routeSlug}?from=replay`);

  await expect(page.getByRole("alert")).toContainText("Playable Earth unavailable");
  await expect(page.getByRole("region", { name: "Playable Earth Lab" })).toHaveCount(0);
  const returnLink = page.getByRole("link", { name: "Return to Replay" });
  await expect(returnLink).toHaveAttribute("href", `#/replay/${routeSlug}`);
  await returnLink.click();
  await expect(page).toHaveURL(new RegExp(`#\\/replay\\/${routeSlug}$`));
});

test("Playable Earth load failure preserves its Replay origin", async ({ page }) => {
  await page.route(`**/data/routes/${routeSlug}.json`, async (request) => {
    await request.fulfill({ status: 500, body: "route unavailable" });
  });
  await page.goto(`/#/lab/playable-earth/${routeSlug}?from=replay`);

  await expect(page.getByRole("alert")).toContainText("Playable route could not load");
  const returnLink = page.getByRole("link", { name: "Return to Replay" });
  await expect(returnLink).toHaveAttribute("href", `#/replay/${routeSlug}`);
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

test("route-locked zoom changes framing without remounting or losing state", async ({
  page,
}) => {
  await installDeterministicEarthRenderer(page);
  await page.goto(`/#/lab/playable-earth/${routeSlug}`);
  const lab = page.getByRole("region", { name: "Playable Earth Lab" });
  const progress = page.getByRole("slider", { name: "Route progress" });

  await expect(lab).toHaveAttribute("data-state", "ready");
  await expect(lab).toHaveAttribute("data-camera-range", "720");
  await page.getByRole("button", { name: "Take control" }).click();
  await progress.fill("5000");
  await page.getByRole("button", { name: "Zoom in to route" }).click();
  await expect(lab).toHaveAttribute("data-camera-range", "240");
  await expect(lab).toHaveAttribute("data-control-mode", "guided");
  expect(Number(await progress.inputValue())).toBeCloseTo(5_000, 0);

  await page.keyboard.press("+");
  await expect(lab).toHaveAttribute("data-camera-range", "120");
  await expect(page.getByRole("button", { name: "Zoom in to route" })).toBeDisabled();
  await page.keyboard.press("-");
  await expect(lab).toHaveAttribute("data-camera-range", "240");
  await page.getByRole("button", { name: "Zoom out from route" }).click();
  await page.getByRole("button", { name: "Zoom out from route" }).click();
  await expect(lab).toHaveAttribute("data-camera-range", "1400");
  await expect(page.getByRole("button", { name: "Zoom out from route" })).toBeDisabled();

  await expect(
    page.locator('canvas[aria-label="Deterministic photorealistic world"]'),
  ).toHaveCount(1);
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __earthLabDestroyCount?: number })
          .__earthLabDestroyCount,
    ),
  ).toBe(0);
  const latestPose = await page.evaluate(() =>
    (window as typeof window & {
      __earthLabPoses?: Array<{ cameraRangeM: number }>;
    }).__earthLabPoses?.at(-1),
  );
  expect(latestPose?.cameraRangeM).toBe(1_400);
});

test("grounding source is inspectable without permanent visual clutter", async ({
  page,
}) => {
  await installDeterministicEarthRenderer(page, "ready", "sampled");
  await page.goto(`/?debugGrounding=1#/lab/playable-earth/${routeSlug}`);
  const lab = page.getByRole("region", { name: "Playable Earth Lab" });

  await expect(lab).toHaveAttribute("data-grounding-source", "sampled");
  await expect(lab).toHaveAttribute("data-grounding-reason", "sampled");
  await expect(lab).toHaveAttribute("data-grounding-offset", "8.50");
  await expect(page.getByText("Grounding: sampled · +8.5 m")).toBeVisible();
});
