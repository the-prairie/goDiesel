import { expect, test, type Page } from "@playwright/test";

const repairedRouteSlug = "13935098460";
const cleanRouteSlug = "10082410891";

async function installDeterministicReplayEngine(page: Page) {
  await page.addInitScript(() => {
    const replayWindow = window as typeof window & {
      __GODIESEL_REPLAY_ENGINE_FACTORY__?: (mode: "earth" | "atlas") => {
        mount(options: {
          onStatus(status: {
            state: "ready" | "partial";
            title: string;
            message: string;
          }): void;
        }): Promise<void>;
        setPose(): void;
        destroy(): void;
      };
    };
    replayWindow.__GODIESEL_REPLAY_ENGINE_FACTORY__ = (mode) => ({
      async mount(options) {
        options.onStatus(
          mode === "earth"
            ? {
                state: "partial",
                title: "3D tiles partially unavailable",
                message: "Deterministic partial Earth world.",
              }
            : {
                state: "ready",
                title: "Replay ready",
                message: "Deterministic Atlas world ready.",
              },
        );
      },
      setPose() {},
      destroy() {},
    });
  });
}

for (const slug of [repairedRouteSlug, cleanRouteSlug, "14486170630"]) {
  test(`route guide keeps processing diagnostics off the map for ${slug}`, async ({ page }) => {
    await page.goto(`/#/routes/${slug}`);
    const geography = page.getByRole("region", { name: "Route geography" });
    await expect(geography).toHaveAttribute("data-map-status", "ready", { timeout: 15_000 });
    await expect(geography.getByTestId("leaf-repair-mark")).toHaveCount(0);
    await expect(geography.getByRole("button", { name: /recorded repair/i })).toHaveCount(0);
    await expect(geography.getByRole("status", { name: "Recorded repair evidence" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reset route map" })).toBeEnabled();
  });
}

test("Replay scrubbing stays unobstructed by processing diagnostics in both engines", async ({ page }) => {
  await installDeterministicReplayEngine(page);
  await page.goto(`/#/replay/${repairedRouteSlug}?renderer=cesium`);
  const scrubber = page.getByTestId("replay-elevation-scrubber");
  await expect(scrubber).toBeVisible();
  await expect(scrubber.getByTestId("replay-repair-mark")).toHaveCount(0);
  await expect(scrubber.getByRole("button", { name: /recorded repair/i })).toHaveCount(0);
  await page.getByRole("button", { name: "Use Atlas replay" }).click();
  await expect(page.getByTestId("replay-stage")).toHaveAttribute("data-engine", "maplibre-atlas");
  const progress = page.getByRole("slider", { name: "Route progress" });
  await progress.fill("1000");
  await expect(progress).toHaveValue("1000");
  await expect(scrubber.getByTestId("replay-repair-mark")).toHaveCount(0);
});
