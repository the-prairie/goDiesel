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
      async mount({ container, onStatus }) {
        container.style.background = "#234b58";
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
    /Crete/,
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
