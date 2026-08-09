import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const routeSlug = process.env.VITE_SINGLE_ROUTE_SLUG;
const routesDirectory = path.resolve(process.cwd(), "public/data/routes");

const route = routeSlug
  ? (JSON.parse(
      fs.readFileSync(path.join(routesDirectory, `${routeSlug}.json`), "utf8"),
    ) as {
      activity_name?: string;
      lifecycle?: string;
      name: string;
      region: string;
      subtitle?: string;
    })
  : null;

// Mirror the rule in route-detail-page.tsx: a discovered route leads with what
// it is called, because it is not a place the owner has been. Anything else
// leads with the place. Assuming one or the other made this spec pass only for
// the discovered route it was written against.
const routeTitle =
  route?.lifecycle === "discovered"
    ? route?.activity_name || route?.name
    : route?.name;

// Any route that is not the shared one, so the redirect assertion is real.
const otherSlug = routeSlug
  ? fs
      .readdirSync(routesDirectory)
      .map((file) => file.replace(/\.json$/, ""))
      .find((slug) => slug !== routeSlug)
  : undefined;

test.describe("single-route microsite", () => {
  test.skip(!routeSlug, "VITE_SINGLE_ROUTE_SLUG is required");

  test("locks navigation and replay to the shared route", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveURL(new RegExp(`#\/routes\/${routeSlug}$`));
    await expect(page.getByRole("heading", { name: routeTitle })).toBeVisible();
    await expect(
      page.getByText(route!.region, { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByTestId("atlas-spine")).toHaveCount(0);
    await expect(page.getByTestId("atlas-spine-mobile")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "All routes" })).toHaveCount(0);

    await page.goto("/#/admin");
    await expect(page).toHaveURL(new RegExp(`#\/routes\/${routeSlug}$`));

    expect(otherSlug, "another route is needed to prove the redirect").toBeTruthy();
    await page.goto(`/#/routes/${otherSlug}`);
    await expect(page).toHaveURL(new RegExp(`#\/routes\/${routeSlug}$`));

    await page.getByRole("link", { name: "Open replay" }).click();
    await expect(page).toHaveURL(new RegExp(`#\/replay\/${routeSlug}$`));
    await expect(page.getByText("Change route", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Route guide" })).toBeVisible();
  });
});
