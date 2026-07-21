import { expect, test, type Page } from "@playwright/test";

async function installJourneyReplayEngine(page: Page) {
  await page.addInitScript(() => {
    const replayWindow = window as typeof window & {
      __journeyEngineModes?: string[];
      __journeyDestroyCount?: number;
      __journeyPoses?: Array<{
        progressM: number;
        following: boolean;
      }>;
      __GODIESEL_REPLAY_ENGINE_FACTORY__?: (mode: "earth" | "atlas") => {
        mount(options: {
          container: HTMLElement;
          onStatus(status: {
            state: "ready" | "partial";
            title: string;
            message: string;
          }): void;
        }): Promise<void>;
        setPose(pose: {
          progressM: number;
          following: boolean;
        }): void;
        destroy(): void;
      };
    };
    replayWindow.__journeyEngineModes = [];
    replayWindow.__journeyDestroyCount = 0;
    replayWindow.__journeyPoses = [];
    replayWindow.__GODIESEL_REPLAY_ENGINE_FACTORY__ = (mode) => ({
      async mount(options) {
        replayWindow.__journeyEngineModes?.push(mode);
        const canvas = document.createElement("canvas");
        canvas.width = 800;
        canvas.height = 600;
        canvas.dataset.journeyCanvas = mode;
        const context = canvas.getContext("2d");
        context?.fillRect(0, 0, 800, 600);
        options.container.append(canvas);
        options.onStatus(
          mode === "earth"
            ? {
                state: "partial",
                title: "3D tiles partially unavailable",
                message: "The route remains usable with Atlas available.",
              }
            : {
                state: "ready",
                title: "Atlas replay ready",
                message: "The cartographic route is ready.",
              },
        );
      },
      setPose(pose) {
        replayWindow.__journeyPoses?.push(pose);
      },
      destroy() {
        replayWindow.__journeyDestroyCount =
          (replayWindow.__journeyDestroyCount ?? 0) + 1;
      },
    });
  });
}

test("Atlas selection becomes a Retrace, then restores its place", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await installJourneyReplayEngine(page);
  await page.goto("/#/atlas?q=kyoto&region=Kyoto%2C+Japan");

  const routeCarousel = page.getByRole("region", {
    name: "Kyoto, Japan recorded routes",
  });
  await expect(routeCarousel).toBeVisible({ timeout: 15_000 });
  const reviewedRoute = routeCarousel
    .getByRole("article")
    .filter({ hasText: "A long, exploratory Kyoto run" });
  await expect(reviewedRoute).toHaveCount(1);
  await reviewedRoute.getByRole("button", { name: /Select / }).click();

  await expect(page).toHaveURL(
    /#\/atlas\?q=kyoto&region=Kyoto%2C\+Japan&route=17654151284$/,
  );
  const selectedAtlasUrl = page.url();
  await reviewedRoute.getByRole("link", { name: "Open route" }).click();

  const stage = page.getByTestId("replay-stage");
  await expect(stage).toHaveAttribute("data-state", "partial");
  await page.getByRole("button", { name: "Use Atlas replay" }).click();
  await expect(stage).toHaveAttribute("data-engine", "maplibre-atlas");
  await expect(stage).toHaveAttribute("data-state", "ready");

  await page.getByRole("button", { name: "Play route" }).click();
  await expect(page.getByRole("button", { name: "Pause route" })).toBeVisible();
  await page.waitForTimeout(1_200);
  await page.getByRole("button", { name: "Pause route" }).click();
  await page.getByLabel("Route progress").fill("10000");
  await page.getByRole("button", { name: "Playback speed 1x" }).click();
  await expect(page.getByRole("button", { name: "Playback speed 2x" })).toBeVisible();
  await page.getByRole("button", { name: "Release camera" }).click();
  await expect(stage).toHaveAttribute("data-light-phase", /dawn|midday/);

  const replayEvidence = await page.evaluate(() => ({
    engines: window.__journeyEngineModes,
    destroyCount: window.__journeyDestroyCount,
    lastPose: window.__journeyPoses?.at(-1),
  }));
  expect(replayEvidence.engines).toEqual(["earth", "atlas"]);
  expect(replayEvidence.destroyCount).toBeGreaterThanOrEqual(1);
  expect(replayEvidence.lastPose?.progressM).toBeGreaterThanOrEqual(10_000);
  expect(replayEvidence.lastPose?.following).toBe(false);

  await page.goBack();
  await expect(page).toHaveURL(selectedAtlasUrl);
  await page.goBack();
  await expect(page).toHaveURL(/#\/atlas\?q=kyoto&region=Kyoto%2C\+Japan$/);
  await expect(routeCarousel).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("textbox", {
    name: "Search this place",
  })).toHaveValue("kyoto");
  await expect(
    page.getByRole("heading", { level: 2, name: "Kyoto, Japan", exact: true }),
  ).toBeVisible();
});
