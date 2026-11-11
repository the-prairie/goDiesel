import { expect, test, type Page } from "@playwright/test";
import type { GoogleRouteNavigatorStatus } from "../src/surfaces/replay/renderers/google-route-navigator-engine";

declare global {
  interface Window {
    __TRAILER_STATUS__?: (status: GoogleRouteNavigatorStatus) => void;
  }
}
async function installTrailer(
  page: Page,
  initial: GoogleRouteNavigatorStatus["state"] = "ready",
) {
  await page.addInitScript((state) => {
    window.__GODIESEL_GOOGLE_ROUTE_NAVIGATOR_FACTORY__ = () => ({
      readCamera() { return undefined; },
      async mount({ container, onStatus }) {
        container.style.background = "#234b58";
        const credits = document.createElement("button");
        credits.textContent = "Provider information fixture";
        credits.style.cssText = "position:absolute;bottom:4px;left:10px;height:24px;z-index:1";
        container.replaceChildren(credits);
        window.__TRAILER_STATUS__ = onStatus;
        onStatus({ state, message: "Controlled trailer provider" });
      },
      setCamera() {},
      setFollowing() {},
      setGrounding() {},
      setCinematicRoute() {},
      setRouteReveal() {},
      destroy() {},
    });
  }, initial);
}
const url = "/#/lab/route-trailer/14736711660";
test("trailer autoplays, pauses, skips and restarts", async ({ page }) => {
  await installTrailer(page);
  await page.goto(url);
  await expect(
    page.getByRole("button", { name: "Pause trailer" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Pause trailer" }).click();
  const progress = page.getByTestId("route-trailer-progress");
  const paused = await progress.getAttribute("style");
  await page.waitForTimeout(200);
  await expect(progress).toHaveAttribute("style", paused!);
  await page.getByRole("button", { name: "Play trailer" }).click();
  await expect(progress).not.toHaveAttribute("style", paused!);
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(page.getByTestId("route-trailer-decision")).toBeVisible();
  await expect(progress).toHaveAttribute("style", "width: 100%;");
  await expect(
    page.getByRole("button", { name: "Play trailer" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Watch again" }).click();
  await expect(
    page.getByRole("button", { name: "Pause trailer" }),
  ).toBeVisible();
  await expect(page.getByTestId("route-trailer-decision")).toHaveCount(0);
});
test("reduced motion starts at the decision and allows explicit restart", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installTrailer(page);
  await page.goto(url);
  await expect(page.getByTestId("route-trailer-decision")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Play trailer" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Watch again" }).click();
  await expect(
    page.getByRole("button", { name: "Pause trailer" }),
  ).toBeVisible();
});
test("failure disables controls and later readiness restarts the trailer", async ({
  page,
}) => {
  await installTrailer(page);
  await page.goto(url);
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await page.evaluate(() =>
    window.__TRAILER_STATUS__?.({
      state: "unavailable",
      message: "Provider failed",
    }),
  );
  await expect(page.getByRole("alert")).toContainText("Provider failed");
  await expect(
    page.getByRole("button", { name: "Play trailer" }),
  ).toBeDisabled();
  await page.evaluate(() =>
    window.__TRAILER_STATUS__?.({ state: "ready", message: "Recovered" }),
  );
  await expect(
    page.getByRole("button", { name: "Pause trailer" }),
  ).toBeEnabled();
  await expect(page.getByTestId("route-trailer-decision")).toHaveCount(0);
});
test("fresh route resets the previous trailer decision", async ({ page }) => {
  await installTrailer(page);
  await page.goto(url);
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await page.goto("/#/lab/route-trailer/14023448720");
  await expect(page.getByTestId("route-trailer")).toHaveAttribute(
    "aria-label",
    /holy balos batman/,
  );
  await expect(
    page.getByRole("button", { name: "Pause trailer" }),
  ).toBeEnabled();
  await expect(page.getByTestId("route-trailer-decision")).toHaveCount(0);
});
test("loading and unavailable previews retain their messages", async ({
  page,
}) => {
  await installTrailer(page, "loading");
  await page.goto(url);
  await expect(page.getByRole("status")).toContainText(
    "Building the route picture",
  );
  await expect(
    page.getByRole("button", { name: "Play trailer" }),
  ).toBeDisabled();
  await page.evaluate(() =>
    window.__TRAILER_STATUS__?.({
      state: "unavailable",
      message: "Missing provider",
    }),
  );
  await expect(page.getByRole("alert")).toContainText("Missing provider");
});

test("trailer completes naturally and stops at the final frame", async ({ page }) => {
  await installTrailer(page);
  await page.goto(url);
  await expect(page.getByRole("button", { name: "Pause trailer" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Play trailer" })).toBeVisible({ timeout: 25000 });
  await expect(page.getByTestId("route-trailer-progress")).toHaveAttribute("style", "width: 100%;");
  await expect(page.getByTestId("route-trailer-decision")).toBeVisible();
});

for (const width of [390, 1280]) {
  test(`unavailable trailer can return to route intelligence at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await installTrailer(page, "unavailable");
    await page.goto(url);
    await expect(page.getByRole("alert")).toBeVisible();
    await page.getByRole("link", { name: "Back to route intelligence" }).click({ timeout: 1500 });
    await expect(page).toHaveURL(/#\/lab\/route-intelligence$/);
  });
}

for (const width of [320, 390, 1280]) {
  test(`trailer decision leaves provider footer clear at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await installTrailer(page);
    await page.goto(url);
    await page.getByRole("button", { name: "Skip", exact: true }).click();
    const footer = await page.getByRole("button", { name: "Provider information fixture" }).boundingBox();
    const decision = await page.getByTestId("route-trailer-decision").boundingBox();
    const play = await page.getByRole("button", { name: "Play trailer" }).boundingBox();
    expect(decision!.y + decision!.height).toBeLessThanOrEqual(footer!.y);
    expect(footer!.y + footer!.height).toBeLessThanOrEqual(play!.y);
    await page.getByRole("button", { name: "Provider information fixture" }).click();
  });
}

for (const providerState of ["loading", "unavailable"] as const) {
  test(`a ${providerState} provider mid-playback freezes progress and disables play, pause and skip`, async ({ page }) => {
    await installTrailer(page);
    await page.goto(url);
    const progress = page.getByTestId("route-trailer-progress");
    await expect(page.getByRole("button", { name: "Pause trailer" })).toBeEnabled();
    const started = await progress.getAttribute("style");
    await expect(progress).not.toHaveAttribute("style", started!);
    await page.evaluate(
      (state) => window.__TRAILER_STATUS__?.({ state, message: `Provider ${state}` }),
      providerState,
    );
    await expect(page.getByTestId("route-trailer")).toHaveAttribute("data-state", providerState);
    await expect(page.getByRole("button", { name: "Pause trailer" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Skip", exact: true })).toBeDisabled();
    const frozen = await progress.getAttribute("style");
    await page.waitForTimeout(300);
    await expect(progress).toHaveAttribute("style", frozen!);
    await page.getByRole("button", { name: "Pause trailer" }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Skip", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("route-trailer-decision")).toHaveCount(0);
    await expect(progress).toHaveAttribute("style", frozen!);
    await page.evaluate(() => window.__TRAILER_STATUS__?.({ state: "ready", message: "Recovered" }));
    await expect(page.getByRole("button", { name: "Pause trailer" })).toBeEnabled();
  });
}

// Google injects its own key-error dialog (.gm-err-container) into the map
// host with an extreme z-index. The lab trailer keeps its diagnostic message
// but nothing of Google's dialog may show around or through the scrim.
for (const width of [390, 1280]) {
  test(`an unavailable trailer hides Google's injected error UI at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await installTrailer(page, "loading");
    await page.goto(url);
    await expect(page.getByRole("status")).toContainText("Building the route picture");
    await page.evaluate(() => {
      const host = document.querySelector('[aria-label^="Google photorealistic 3D trailer"]')!;
      const error = document.createElement("div");
      error.className = "gm-err-container";
      error.style.cssText = "position:absolute;inset:0;z-index:2147483647;background:#e5e3df;color:#3c4043";
      error.textContent = "Oops! Something went wrong.";
      host.append(error);
    });
    const exposure = () => page.evaluate(() => {
      const error = document.querySelector<HTMLElement>(".gm-err-container")!;
      const host = error.parentElement!;
      const scrim = document.querySelector<HTMLElement>('[data-testid="route-trailer-scrim"]')!;
      const box = error.getBoundingClientRect();
      const leaks: string[] = [];
      for (let row = 1; row < 6; row++) {
        for (let column = 1; column < 6; column++) {
          const target = document.elementFromPoint(box.left + box.width * column / 6, box.top + box.height * row / 6);
          if (target && host.contains(target)) leaks.push(`${row},${column}`);
        }
      }
      return {
        scrim: getComputedStyle(scrim).backgroundColor,
        hostIsolated: getComputedStyle(host).isolation === "isolate",
        leaks,
      };
    });
    // Loading: the host stays live under the scrim, so only opacity counts.
    expect(await exposure()).toMatchObject({ scrim: "rgb(0, 0, 0)", hostIsolated: true });
    await page.evaluate(() => window.__TRAILER_STATUS__?.({
      state: "unavailable",
      message: "Google Maps rejected this browser origin. Add the current localhost or preview URL to the key restrictions.",
    }));
    await expect(page.getByRole("alert")).toContainText("Google Maps rejected this browser origin.");
    expect(await exposure()).toEqual({ scrim: "rgb(0, 0, 0)", hostIsolated: true, leaks: [] });
    await expect(page.locator(".gm-err-container")).toBeHidden();
    await expect(page.locator('[aria-label^="Google photorealistic 3D trailer"]')).toHaveAttribute("inert", "");
    await expect(page.getByRole("button", { name: "Play trailer" })).toBeDisabled();
    await page.evaluate(() => window.__TRAILER_STATUS__?.({ state: "ready", message: "Controlled trailer provider" }));
    const host = page.locator('[aria-label^="Google photorealistic 3D trailer"]');
    await expect(host).not.toHaveAttribute("inert", "");
    await expect(host).toBeVisible();
  });
}
