import { expect, test, type Page } from "@playwright/test";

async function installGoogleReplay(
  page: Page,
  state: "ready" | "unavailable",
) {
  await page.addInitScript((providerState) => {
    const replayWindow = window as typeof window & {
      __GODIESEL_GOOGLE_ROUTE_NAVIGATOR_FACTORY__?: () => {
        mount(options: {
          container: HTMLElement;
          onStatus: (status: {
            state: "ready" | "unavailable";
            message: string;
          }) => void;
        }): Promise<void>;
        setCamera(): void;
        setFollowing(): void;
        setGrounding(): void;
        setCinematicRoute(): void;
        setRouteReveal(): void;
        destroy(): void;
      };
      __GODIESEL_REPLAY_ENGINE_FACTORY__?: () => {
        mount(options: {
          container: HTMLElement;
          onStatus: (status: {
            state: "ready";
            title: string;
            message: string;
          }) => void;
        }): Promise<void>;
        setPose(): void;
        destroy(): void;
      };
    };

    replayWindow.__GODIESEL_GOOGLE_ROUTE_NAVIGATOR_FACTORY__ = () => ({
      async mount({ container, onStatus }) {
        if (providerState === "unavailable") {
          onStatus({
            state: "unavailable",
            message: "Google 3D fixture unavailable.",
          });
          return;
        }
        const canvas = document.createElement("canvas");
        canvas.dataset.renderer = "google-production";
        canvas.style.background = "rgb(30, 80, 96)";
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        container.replaceChildren(canvas);
        onStatus({ state: "ready", message: "Google 3D fixture ready." });
      },
      setCamera() {},
      setFollowing() {},
      setGrounding() {},
      setCinematicRoute() {},
      setRouteReveal() {},
      destroy() {},
    });

    replayWindow.__GODIESEL_REPLAY_ENGINE_FACTORY__ = () => ({
      async mount({ container, onStatus }) {
        const canvas = document.createElement("canvas");
        canvas.dataset.renderer = "atlas-fallback";
        container.replaceChildren(canvas);
        onStatus({
          state: "ready",
          title: "Atlas replay ready",
          message: "Fallback fixture ready.",
        });
      },
      setPose() {},
      destroy() {},
    });
  }, state);
}

test("opens production Replay in Google 3D", async ({ page }) => {
  await installGoogleReplay(page, "ready");
  await page.goto("/#/replay/14023448720");

  const replay = page.getByTestId("replay-stage");
  await expect(replay).toHaveAttribute("data-engine", "google-3d-maps");
  await expect(replay).toHaveAttribute("data-state", "ready");
  await expect(page.getByText("Google 3D Replay", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Change route" })).toBeVisible();

  await page.getByRole("button", { name: "Play route" }).click();
  await expect(replay).toHaveAttribute("data-hud-state", "compact");
  await expect
    .poll(async () =>
      Number((await page.getByTestId("google-route-progress").textContent())?.split(" ")[0]),
    )
    .toBeGreaterThan(0);
});

test("falls back from Google 3D to Atlas replay", async ({ page }) => {
  await installGoogleReplay(page, "unavailable");
  await page.goto("/#/replay/14023448720");

  await expect(page.getByRole("alert")).toContainText("3D world unavailable");
  await page.getByRole("button", { name: "Use Atlas replay" }).click();

  const replay = page.getByTestId("replay-stage");
  await expect(replay).toHaveAttribute("data-engine", "maplibre-atlas");
  await expect(replay).toHaveAttribute("data-state", "ready");
  await expect(page.locator('[data-renderer="atlas-fallback"]')).toBeVisible();
});
