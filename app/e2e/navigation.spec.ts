import { expect, test } from "@playwright/test";

const routeSlug = "17654151284";
const historyRouteSlug = "17665674778";

test("root opens Atlas and primary navigation follows browser history", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page).toHaveURL(/#\/atlas$/);
  await expect(
    page.getByRole("link", { name: "Memories", exact: true }),
  ).toHaveAttribute("aria-current", "page");

  await page.getByRole("link", { name: "Plan", exact: true }).click();
  await expect(page).toHaveURL(/#\/finder$/);
  await expect(page.getByRole("heading", { name: /plan/i })).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/#\/atlas$/);

  await page.goForward();
  await expect(page).toHaveURL(/#\/finder$/);
});

test("compact Atlas navigation supports keyboard entry and restores focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/#/atlas");

  const trigger = page.getByRole("button", {
    name: "Open application navigation",
  });
  await trigger.focus();
  await page.keyboard.press("Enter");

  const navigation = page.getByRole("dialog", { name: "goDiesel navigation" });
  await expect(navigation).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Atlas" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(navigation.getByRole("link", { name: "Finder" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(navigation).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("every product surface has a canonical URL", async ({ page }) => {
  await page.goto("/#/atlas");

  await page.getByRole("button", { name: "Open application navigation" }).click();

  for (const [label, path] of [
    ["Routes", "routes"],
    ["Replay", "replay"],
    ["Admin", "admin"],
  ] as const) {
    if (label === "Admin") {
      await page.goto("/#/admin");
    } else {
      await page.getByRole("link", { name: label }).click();
    }
    await expect(page).toHaveURL(new RegExp(`#/${path}$`));
    if (label === "Replay") {
      await expect(page.locator('[data-replay-shell="story-flight"]')).toBeVisible();
      await expect(page.getByTestId("atlas-spine")).toHaveCount(0);
    } else {
      await expect(page.getByRole("link", { name: label })).toHaveAttribute(
        "aria-current",
        "page",
      );
    }
  }
});

test("canonical product and selected-route URLs load directly", async ({
  page,
}) => {
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
    if (path.startsWith("replay")) {
      await expect(page.locator('[data-replay-shell="story-flight"]')).toBeVisible();
      await expect(page.getByTestId("atlas-spine")).toHaveCount(0);
      continue;
    }
    if (path === "atlas") {
      await page.getByRole("button", { name: "Open application navigation" }).click();
    }
    await expect(
      path === "atlas"
        ? page
            .getByRole("dialog", { name: "goDiesel navigation" })
            .getByRole("link", { name: activeNavigation, exact: true })
        : page.getByRole("link", { name: activeNavigation, exact: true }),
    ).toHaveAttribute("aria-current", "page");
  }
});

test("legacy quest links preserve the route in canonical detail", async ({
  page,
}) => {
  await page.goto(`/#quest/${routeSlug}`);

  await expect(page).toHaveURL(new RegExp(`#\/routes\/${routeSlug}$`));
  await expect(page.getByRole("main")).toContainText(/km/i);
  await expect(
    page.getByRole("link", { name: /open replay/i }),
  ).toHaveAttribute("href", `#/replay/${routeSlug}`);
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
  await expect(page.getByTestId("replay-stage")).toHaveAttribute(
    "data-route-slug",
    routeSlug,
  );

  await page.getByText("Change route", { exact: true }).click();
  await page.locator(`a[href="#/replay/${historyRouteSlug}"]`).click();
  await expect(page).toHaveURL(new RegExp(`#\/replay\/${historyRouteSlug}$`));
  await expect(page.getByTestId("replay-stage")).toHaveAttribute(
    "data-route-slug",
    historyRouteSlug,
  );

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`#\/replay\/${routeSlug}$`));
  await expect(page.getByTestId("replay-stage")).toHaveAttribute(
    "data-route-slug",
    routeSlug,
  );

  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`#\/replay\/${historyRouteSlug}$`));
  await expect(page.getByTestId("replay-stage")).toHaveAttribute(
    "data-route-slug",
    historyRouteSlug,
  );
});

test("mobile bottom spine navigates without covering the current page", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/atlas");

  const main = page.getByRole("main");
  const mobileSpine = page.getByTestId("atlas-spine-mobile");

  await expect(main).toBeVisible();
  await expect(mobileSpine).toBeVisible();
  await mobileSpine.getByRole("link", { name: "Routes" }).click();
  await expect(page).toHaveURL(/#\/routes$/);
  await expect(main).toBeVisible();
  await expect(
    mobileSpine.getByRole("link", { name: "Routes" }),
  ).toHaveAttribute("aria-current", "page");
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
    await expect(page.getByTestId("replay-controls")).toBeVisible();

    const layout = await page.evaluate(() => {
      const main = document.querySelector("main");
      const sidebar = document.querySelector<HTMLElement>(
        '[data-slot="sidebar-container"]',
      );
      const mobileSpine = document.querySelector<HTMLElement>(
        '[data-testid="atlas-spine-mobile"]',
      );
      const mainRect = main?.getBoundingClientRect();
      const sidebarRect = sidebar?.getBoundingClientRect();
      const mobileRect = mobileSpine?.getBoundingClientRect();
      const replayControlsRect = document
        .querySelector<HTMLElement>('[data-testid="replay-controls"]')
        ?.getBoundingClientRect();

      return {
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        mainLeft: mainRect?.left ?? 0,
        mainRight: mainRect?.right ?? 0,
        mainBottom: mainRect?.bottom ?? 0,
        replayControlsBottom: replayControlsRect?.bottom ?? 0,
        sidebarRight:
          sidebar && getComputedStyle(sidebar).display !== "none"
            ? (sidebarRect?.right ?? 0)
            : null,
        mobileTop:
          mobileSpine && getComputedStyle(mobileSpine).display !== "none"
            ? (mobileRect?.top ?? null)
            : null,
      };
    });

    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
    expect(layout.mainRight).toBeLessThanOrEqual(layout.viewportWidth + 1);
    if (layout.sidebarRight !== null) {
      expect(layout.mainLeft).toBeGreaterThanOrEqual(layout.sidebarRight - 1);
    }

    if (layout.mobileTop !== null) {
      expect(layout.mainBottom).toBeLessThanOrEqual(layout.mobileTop + 1);
      expect(layout.replayControlsBottom).toBeLessThanOrEqual(
        layout.mobileTop + 1,
      );
    }
  }
});

test("mobile Replay owns the viewport without global navigation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/#/replay/${routeSlug}`);
  await expect(page.getByTestId("replay-controls")).toBeVisible();

  await page.evaluate(() => {
    document.documentElement.style.setProperty("--safe-area-bottom", "24px");
  });

  const layout = await page.evaluate(() => {
    const controls = document
      .querySelector<HTMLElement>('[data-testid="replay-controls"]')!
      .getBoundingClientRect();

    return {
      controlsBottom: controls.bottom,
      documentWidth: document.documentElement.scrollWidth,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
    };
  });

  await expect(page.getByTestId("atlas-spine-mobile")).toHaveCount(0);
  expect(layout.controlsBottom).toBeLessThanOrEqual(layout.viewportHeight + 1);
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
});

test("mobile spine keeps every primary destination legible", async ({
  page,
}) => {
  test.setTimeout(60_000);
  for (const width of [320, 360, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    for (const [path, label] of [
      ["atlas", "Atlas"],
      ["finder", "Finder"],
      ["routes", "Routes"],
      ["admin", "Admin"],
    ] as const) {
      await page.goto(`/#/${path}`);
      const spine = page.getByTestId("atlas-spine-mobile");
      const link = spine.getByRole("link", { name: label, exact: true });
      await expect(spine).toBeVisible();
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute("aria-current", "page");

      const box = await link.boundingBox();
      expect(box).not.toBeNull();
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width + 1);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
    }
  }
});

test("utility surfaces retain the product subtitle on desktop", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/#/routes");

  await expect(page.getByTestId("app-page-title")).toHaveText("Routes");
  await expect(page.getByTestId("global-product-subtitle")).toHaveText(
    "Relive where you have been. Discover where to go next.",
  );
  await expect(page.getByTestId("global-product-subtitle")).toBeVisible();
  await expect(page.getByTestId("atlas-spine")).toBeVisible();
});

test("Finder uses the map shell without global header chrome", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/#/finder");

  await expect(page.getByTestId("atlas-spine")).toBeVisible();
  await expect(page.getByTestId("app-header")).toBeHidden();
  await expect(page.getByRole("heading", { name: "Plan the next day." })).toBeVisible();
});

test("immersive Atlas replaces the content spine with compact navigation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/#/atlas?region=Kyoto%2C+Japan");

  await expect(page.getByTestId("atlas-spine")).toHaveCount(0);
  await expect(page.getByTestId("atlas-compact-navigation")).toBeVisible();
  await expect(page.getByTestId("app-header")).toBeHidden();

  await expect(page.getByRole("link", { name: "Memories" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("link", { name: "Plan" })).toHaveAttribute(
    "href",
    "#/finder",
  );

  await page.getByRole("button", { name: "Open application navigation" }).click();
  const navigation = page.getByRole("dialog", { name: "goDiesel navigation" });
  await expect(navigation).toBeVisible();
  for (const destination of ["Atlas", "Finder", "Routes", "Replay", "Admin"]) {
    await expect(navigation.getByRole("link", { name: destination })).toBeVisible();
  }
  await page.keyboard.press("Escape");
  await expect(navigation).toBeHidden();

  await page.getByRole("link", { name: "Return to global Atlas" }).click();
  await expect(page).toHaveURL(/#\/atlas$/);
});

test("field-guide shell has stable desktop and mobile compositions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/#/routes");
  await expect(page.getByTestId("atlas-spine")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your route library." }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("field-guide-shell-desktop.png", {
    animations: "disabled",
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/routes");
  await expect(page.getByTestId("atlas-spine-mobile")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your route library." }),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("field-guide-shell-mobile.png", {
    animations: "disabled",
  });
});
