import { expect, test } from "@playwright/test";

const finderChunk = /\/assets\/finder-page-[^/]+\.js$/;

test("a missing lazy route refreshes once and preserves the Finder query", async ({ page }) => {
  let requests = 0;
  let documents = 0;
  page.on("request", request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents++; });
  await page.route(finderChunk, route => ++requests === 1 ? route.abort("failed") : route.continue());
  await page.goto("/#/finder?place=Kyoto&activity=Run&distance=21");
  await expect(page.getByRole("heading", { name: "Plan the next day." })).toBeVisible();
  await expect(page).toHaveURL(/#\/finder\?place=Kyoto&activity=Run&distance=21$/);
  expect(requests).toBe(2);
  expect(documents).toBe(2);
});

test("persistent chunk failure stops refreshing and offers a working manual retry", async ({ page }) => {
  let requests = 0;
  let fail = true;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(finderChunk, route => { requests++; return fail ? route.abort("failed") : route.continue(); });
  await page.goto("/#/finder?place=Kyoto");
  await expect(page.getByRole("heading", { name: "Let’s get you back on track." })).toBeVisible();
  await expect(page.getByText("Unexpected Application Error!")).toHaveCount(0);
  await expect(page.getByText(/TypeError|Hey developer/)).toHaveCount(0);
  expect(requests).toBe(2);
  await page.screenshot({ path: "e2e/evidence/load-recovery/mobile.png" });
  fail = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Plan the next day." })).toBeVisible();
  await expect(page).toHaveURL(/#\/finder\?place=Kyoto$/);
});

test("blocked storage avoids automatic reload and keeps an escape route", async ({ page }) => {
  await page.addInitScript(() => { Storage.prototype.setItem = () => { throw new Error("Storage blocked"); }; });
  let requests = 0;
  await page.route(finderChunk, route => { requests++; return route.abort("failed"); });
  await page.goto("/#/finder");
  await expect(page.getByRole("heading", { name: "Let’s get you back on track." })).toBeVisible();
  expect(requests).toBe(1);
  await page.screenshot({ path: "e2e/evidence/load-recovery/desktop.png" });
  await page.getByRole("link", { name: "Back to routes" }).click();
  await expect(page.getByRole("heading", { name: "Places worth returning to." })).toBeVisible();
});
