import { expect, test, type Page } from "@playwright/test";

async function installReplayEngine(page: Page, earthState: "ready" | "partial" = "ready") {
  await page.addInitScript((state) => {
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
        options.onStatus({
          state: mode === "earth" ? state : "ready",
          title: "Replay ready",
          message: "Deterministic replay world ready.",
        });
      },
      setPose() {},
      destroy() {},
    });
  }, earthState);
}

test("urban and mountain replays use their recorded local light", async ({ page }) => {
  await installReplayEngine(page);
  await page.goto("/#/replay/17654151284");

  const stage = page.getByTestId("replay-stage");
  const lighting = page.getByTestId("recorded-light");
  await expect(stage).toHaveAttribute("data-state", "ready");
  await expect(lighting).toHaveAttribute("data-light-phase", "dawn");
  await expect(page.getByText(/Recorded dawn/i)).toBeVisible();

  await page.goto("/#/replay/13358070690");
  await expect(stage).toHaveAttribute("data-route-slug", "13358070690");
  await expect(lighting).toHaveAttribute("data-light-phase", "midday");
});

test("lighting remains stable when Earth falls back to Atlas", async ({ page }) => {
  await installReplayEngine(page, "partial");
  await page.goto("/#/replay/17654151284");

  const lighting = page.getByTestId("recorded-light");
  await expect(lighting).toHaveAttribute("data-light-phase", "dawn");
  await page.getByRole("button", { name: "Use Atlas replay" }).click();
  await expect(page.getByTestId("replay-stage")).toHaveAttribute("data-engine", "maplibre-atlas");
  await expect(lighting).toHaveAttribute("data-light-phase", "dawn");
});

test("missing local-time provenance stays neutral and reduced motion removes drift", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installReplayEngine(page);
  await page.route("**/data/routes/17654151284.json", async (request) => {
    const response = await request.fetch();
    const body = await response.json();
    delete body.provenance.temporal.time_zone;
    await request.fulfill({ response, json: body });
  });
  await page.goto("/#/replay/17654151284");

  const lighting = page.getByTestId("recorded-light");
  await expect(lighting).toHaveAttribute("data-light-phase", "neutral");
  await expect(lighting).toHaveAttribute("data-motion", "static");
  await expect(page.getByText(/Recorded (dawn|midday|dusk|night)/i)).toHaveCount(0);
});
