import { expect, test } from "@playwright/test";

const routeSlug = process.env.VITE_SINGLE_ROUTE_SLUG;

test.describe("single-route microsite", () => {
  test.skip(!routeSlug, "VITE_SINGLE_ROUTE_SLUG is required");

  test("locks navigation and replay to the shared route", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveURL(new RegExp(`#\/routes\/${routeSlug}$`));
    await expect(
      page.getByRole("heading", { name: "breaking ankles on the Appian Way" }),
    ).toBeVisible();
    await expect(page.getByTestId("atlas-spine")).toHaveCount(0);
    await expect(page.getByTestId("atlas-spine-mobile")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "All routes" })).toHaveCount(0);

    await page.goto("/#/admin");
    await expect(page).toHaveURL(new RegExp(`#\/routes\/${routeSlug}$`));

    await page.goto("/#/routes/17654151284");
    await expect(page).toHaveURL(new RegExp(`#\/routes\/${routeSlug}$`));

    await page.getByRole("link", { name: "Open replay" }).click();
    await expect(page).toHaveURL(new RegExp(`#\/replay\/${routeSlug}$`));
    await expect(page.getByText("Change route", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Route guide" })).toBeVisible();
  });
});
