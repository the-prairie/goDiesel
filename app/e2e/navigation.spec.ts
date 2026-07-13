import { expect, test } from "@playwright/test";

const routeSlug = "17654151284";
const historyRouteSlug = "17665674778";

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

test("canonical product and selected-route URLs load directly", async ({ page }) => {
  for (const [path, activeNavigation] of [
    ["atlas", "Atlas"],
    ["finder", "Finder"],
    ["routes", "Routes"],
    ["replay", "Replay"],
    ["admin", "Admin"],
    [`routes/${routeSlug}`, "Routes"],
    [`replay/${routeSlug}`, "Replay"],
  ] as const) {
    await page.goto(`/#/${path}`);
    await expect(page).toHaveURL(new RegExp(`#/${path}$`));
    await expect(
      page.getByRole("link", { name: activeNavigation, exact: true }),
    ).toHaveAttribute("aria-current", "page");
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

test("legacy quest links are canonicalized after the app has started", async ({
  page,
}) => {
  await page.goto("/#/finder");
  await page.evaluate((slug) => {
    window.location.hash = `quest/${slug}`;
  }, routeSlug);

  await expect(page).toHaveURL(new RegExp(`#\/routes\/${routeSlug}$`));
  await expect(
    page.getByRole("link", { name: "Routes", exact: true }),
  ).toHaveAttribute("aria-current", "page");
});

test("malformed legacy quest links canonicalize to the unavailable route state", async ({
  page,
}) => {
  await page.goto("/#quest/%");

  await expect(page).toHaveURL(/#\/routes\/%25$/);
  await expect(
    page.getByRole("heading", { name: "This route could not be found." }),
  ).toBeVisible();
});

test("browser history restores the selected Replay route", async ({ page }) => {
  await page.goto(`/#/replay/${routeSlug}`);
  await expect(page.getByRole("heading", { name: "Kyoto, Japan" })).toBeVisible();

  await page.locator(`a[href="#/replay/${historyRouteSlug}"]`).click();
  await expect(page).toHaveURL(new RegExp(`#\/replay\/${historyRouteSlug}$`));
  await expect(page.getByRole("heading", { name: "Tokyo, Japan" })).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`#\/replay\/${routeSlug}$`));
  await expect(page.getByRole("heading", { name: "Kyoto, Japan" })).toBeVisible();

  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`#\/replay\/${historyRouteSlug}$`));
  await expect(page.getByRole("heading", { name: "Tokyo, Japan" })).toBeVisible();
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

test("navigation does not persistently overlap Replay across breakpoints", async ({
  page,
}) => {
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 820, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(`/#/replay/${routeSlug}`);

    const layout = await page.evaluate(() => {
      const main = document.querySelector("main");
      const sidebar = document.querySelector<HTMLElement>(
        '[data-slot="sidebar-container"]',
      );
      const mainRect = main?.getBoundingClientRect();
      const sidebarRect = sidebar?.getBoundingClientRect();

      return {
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        mainLeft: mainRect?.left ?? 0,
        mainRight: mainRect?.right ?? 0,
        sidebarRight:
          sidebar && getComputedStyle(sidebar).display !== "none"
            ? (sidebarRect?.right ?? 0)
            : null,
      };
    });

    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
    expect(layout.mainRight).toBeLessThanOrEqual(layout.viewportWidth + 1);
    if (layout.sidebarRight !== null) {
      expect(layout.mainLeft).toBeGreaterThanOrEqual(layout.sidebarRight - 1);
    }

    if (viewport.width < 768) {
      const navigationButton = page.getByRole("button", {
        name: "Open navigation",
      });
      await navigationButton.click();
      const closeButton = page.getByRole("button", { name: "Close navigation" });
      await expect(closeButton).toBeVisible();
      await closeButton.click();
      await expect(closeButton).toBeHidden();
    }
  }
});
