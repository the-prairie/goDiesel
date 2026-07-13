import { expect, test } from "@playwright/test";

const routeSlug = "17654151284";

test("root opens Atlas and primary navigation follows browser history", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page).toHaveURL(/#\/atlas$/);
  await expect(page.getByRole("link", { name: "Atlas", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await page.getByRole("link", { name: "Finder" }).click();
  await expect(page).toHaveURL(/#\/finder$/);
  await expect(page.getByRole("heading", { name: /plan/i })).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/#\/atlas$/);

  await page.goForward();
  await expect(page).toHaveURL(/#\/finder$/);
});

test("every product surface has a canonical URL", async ({ page }) => {
  await page.goto("/#/atlas");

  for (const [label, path] of [
    ["Routes", "routes"],
    ["Replay", "replay"],
    ["Admin", "admin"],
  ] as const) {
    await page.getByRole("link", { name: label }).click();
    await expect(page).toHaveURL(new RegExp(`#/${path}$`));
    await expect(page.getByRole("link", { name: label })).toHaveAttribute(
      "aria-current",
      "page",
    );
  }
});

test("legacy quest links preserve the route in canonical detail", async ({
  page,
}) => {
  await page.goto(`/#quest/${routeSlug}`);

  await expect(page).toHaveURL(new RegExp(`#\/routes\/${routeSlug}$`));
  await expect(page.getByRole("main")).toContainText(/km/i);
  await expect(page.getByRole("link", { name: /open replay/i })).toHaveAttribute(
    "href",
    `#/replay/${routeSlug}`,
  );
});

test("mobile navigation opens without covering the current page", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/atlas");

  const main = page.getByRole("main");
  const navigationButton = page.getByRole("button", { name: /open navigation/i });

  await expect(main).toBeVisible();
  await expect(navigationButton).toBeVisible();
  await navigationButton.click();

  const mobileNavigation = page.getByRole("navigation", { name: "Primary" });
  await expect(mobileNavigation).toBeVisible();
  await expect(page.getByRole("button", { name: "Close navigation" })).toBeVisible();
  await mobileNavigation.getByRole("link", { name: "Routes" }).click();
  await expect(page).toHaveURL(/#\/routes$/);
  await expect(main).toBeVisible();
});
