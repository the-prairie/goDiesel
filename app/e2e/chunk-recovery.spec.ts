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

test("offline, a surface not yet downloaded says so inside the shell and never reloads", async ({ page, context }) => {
  let documents = 0;
  page.on("request", request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents++; });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/routes");
  await expect(page.getByRole("heading", { name: "Places worth returning to." })).toBeVisible();
  const nav = page.getByTestId("atlas-spine-mobile");

  await context.setOffline(true);
  await nav.getByRole("link", { name: "Finder", exact: true }).click();
  await expect(page.getByRole("heading", { name: "You’re offline." })).toBeVisible();
  await expect(page.getByText("Finder hasn’t been downloaded yet")).toBeVisible();
  await expect(nav).toBeVisible();

  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByText("Still offline.")).toBeVisible();
  await expect(page).toHaveURL(/#\/finder$/);
  expect(documents).toBe(1);

  await page.getByRole("button", { name: "Go back", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Places worth returning to." })).toBeVisible();

  await page.goForward();
  await expect(page.getByRole("heading", { name: "You’re offline." })).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByRole("heading", { name: "You’re back online." })).toBeVisible();
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Plan the next day." })).toBeVisible();
  await expect(page).toHaveURL(/#\/finder$/);
});

test("a surface that fails to download online is handled inside the shell", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(finderChunk, route => route.abort("failed"));
  await page.goto("/#/finder");
  await expect(page.getByRole("heading", { name: "Let’s get you back on track." })).toBeVisible();
  await expect(page.getByTestId("atlas-spine-mobile")).toBeVisible();
  await page.getByTestId("atlas-spine-mobile").getByRole("link", { name: "Routes", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Places worth returning to." })).toBeVisible();
});
