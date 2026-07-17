import { expect, test, type Page } from "@playwright/test";

const repairedRouteSlug = "13935098460";
const cleanRouteSlug = "10082410891";

async function installDeterministicReplayEngine(page: Page) {
  await page.addInitScript(() => {
    const replayWindow = window as typeof window & {
      __GODIESEL_REPLAY_ENGINE_FACTORY__?: (mode: "earth" | "atlas") => {
        mount(options: {
          avatarElement: HTMLElement;
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
        options.avatarElement.style.display = "block";
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

test("Leaf renders only source-backed repairs and exposes factual evidence", async ({
  page,
}) => {
  await page.goto(`/#/routes/${repairedRouteSlug}`);

  const geography = page.getByRole("region", { name: "Route geography" });
  await expect(geography).toHaveAttribute("data-map-status", "ready", {
    timeout: 15_000,
  });
  await expect(geography.getByTestId("leaf-repair-mark")).toHaveCount(3);
  const repairs = geography.getByRole("button", { name: /recorded repair/i });
  await expect(repairs).toHaveCount(2);
  await repairs.first().focus();
  await expect(repairs.first()).toBeFocused();
  await repairs.first().press("Enter");
  await expect(geography.getByRole("status", { name: "Recorded repair evidence" })).toContainText(
    "Recorded timestamps",
  );
  await expect(geography.getByRole("status", { name: "Recorded repair evidence" })).toContainText(
    "No route geometry was inferred",
  );
});

test("clean Leaf routes render no decorative gold", async ({ page }) => {
  await page.goto(`/#/routes/${cleanRouteSlug}`);

  const geography = page.getByRole("region", { name: "Route geography" });
  await expect(geography).toHaveAttribute("data-map-status", "ready", {
    timeout: 15_000,
  });
  await expect(geography.getByTestId("leaf-repair-mark")).toHaveCount(0);
  await expect(geography.getByRole("status", { name: "Recorded repair evidence" })).toHaveCount(0);
});

test("Replay uses the same source-backed repair distances in both engines", async ({
  page,
}) => {
  await installDeterministicReplayEngine(page);
  await page.goto(`/#/replay/${repairedRouteSlug}`);

  const scrubber = page.getByTestId("replay-elevation-scrubber");
  const repairMarks = scrubber.getByTestId("replay-repair-mark");
  await expect(repairMarks).toHaveCount(3);
  await expect(repairMarks.nth(0)).toHaveAttribute("data-repair-distance-m", /9521/);
  await expect(repairMarks.nth(1)).toHaveAttribute("data-repair-distance-m", /9967/);
  await expect(repairMarks.nth(2)).toHaveAttribute("data-repair-distance-m", /22536/);

  await scrubber.getByRole("button", { name: /2 recorded repairs/i }).click();
  await expect(scrubber.getByRole("status", { name: "Recorded repair evidence" })).toContainText(
    "Recorded timestamps",
  );

  await page.getByRole("button", { name: "Use Atlas replay" }).click();
  await expect(page.getByTestId("replay-stage")).toHaveAttribute("data-engine", "maplibre-atlas");
  await expect(scrubber.getByTestId("replay-repair-mark")).toHaveCount(3);
});
