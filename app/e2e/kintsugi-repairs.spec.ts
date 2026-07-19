import { expect, test, type Page } from "@playwright/test";

const repairedRouteSlug = "13935098460";
const cleanRouteSlug = "10082410891";
const repairedCreteRouteSlug = "14023448720";

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

test("Replay actions and repair affordances share their visual baselines", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installDeterministicReplayEngine(page);
  await page.goto(`/#/replay/${repairedCreteRouteSlug}`);
  await expect(page.getByTestId("replay-stage")).toHaveAttribute("data-state", "partial");

  const enterRoute = await page.getByRole("link", { name: "Enter route" }).boundingBox();
  const changeRoute = await page.getByRole("button", { name: "Change route" }).boundingBox();
  expect(enterRoute).not.toBeNull();
  expect(changeRoute).not.toBeNull();
  expect(Math.abs(enterRoute!.y - changeRoute!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(enterRoute!.height - changeRoute!.height)).toBeLessThanOrEqual(1);

  const scrubber = page.getByTestId("replay-elevation-scrubber");
  const repairMarks = scrubber.getByTestId("replay-repair-mark");
  const repairTargets = scrubber.getByRole("button", { name: /recorded repair/i });
  await expect(repairMarks).toHaveCount(3);
  await expect(repairTargets).toHaveCount(3);
  for (let index = 0; index < 3; index += 1) {
    const mark = await repairMarks.nth(index).boundingBox();
    const target = await repairTargets.nth(index).boundingBox();
    expect(mark).not.toBeNull();
    expect(target).not.toBeNull();
    const markCenterY = mark!.y + mark!.height / 2;
    const targetCenterY = target!.y + target!.height / 2;
    expect(Math.abs(markCenterY - targetCenterY)).toBeLessThanOrEqual(1);
  }
});
