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
// A completed route is titled by its activity name when it has one
// (routeName in domain/route/parse-shared.ts).
const routeTitle =
  route?.lifecycle === "discovered" ||
  (route?.lifecycle === "completed" && route.activity_name?.trim())
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

  test("never requests product surfaces or another route's data", async ({ page }) => {
    const requested: string[] = [];
    page.on("request", (request) => requested.push(new URL(request.url()).pathname));

    await page.goto("/");
    await expect(page.getByRole("heading", { name: routeTitle })).toBeVisible();
    for (const path of ["/#/courses", "/#/finder", "/#/lab/design-system", `/#/replay/${otherSlug}`]) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`#\/routes\/${routeSlug}$`));
    }
    await page.getByRole("link", { name: "Open replay" }).click();
    await expect(page.getByRole("button", { name: "Route guide" })).toBeVisible();

    const productChunk = /\/assets\/(?:admin|atlas|finder|routes|course|course-preview|[a-z-]+-lab)-page-/;
    expect(requested.filter((path) => productChunk.test(path))).toEqual([]);
    expect(
      requested.filter(
        (path) => path.startsWith("/data/") && path !== `/data/routes/${routeSlug}.json`,
      ),
    ).toEqual([]);
  });

  test("keeps the shared guide usable on a mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    await expect(page.getByRole("heading", { name: routeTitle })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open replay" })).toBeVisible();
    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(horizontalOverflow).toBeLessThanOrEqual(1);
  });
});
