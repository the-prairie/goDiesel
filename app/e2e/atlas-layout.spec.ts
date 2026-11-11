import { expect, test } from "@playwright/test";
import { installDeterministicCesiumAtlas } from "./helpers/deterministic-atlas";

// Layout checks do not depend on external imagery or GPU startup. Live
// terrain and orbital rendering have their own provider tests.
test.beforeEach(async ({ page }) => {
  await installDeterministicCesiumAtlas(page);
});

for (const viewport of [
  { width: 320, height: 568 },
  { width: 390, height: 320 },
  { width: 390, height: 844 },
  { width: 390, height: 660 },
  { width: 1280, height: 900 },
  { width: 844, height: 390 },
]) {
  test(`Atlas discovery and map tools remain usable at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/#/atlas");
    const world = page.locator('div[data-atlas-engine="cesium"]');
    await expect(world).toHaveAttribute("data-atlas-status", "ready");
    const search = page.getByRole("region", { name: "Atlas search" });
    const tools = page.getByRole("group", { name: "Map controls" });
    const activity = page.getByRole("group", { name: "Activity filter" });
    const box = (await search.boundingBox())!;
    const activityBox = (await activity.boundingBox())!;
    expect(activityBox.y).toBeGreaterThanOrEqual(box.y + box.height);
    expect(activityBox.x).toBe(box.x);
    const mapButtons = await tools.getByRole("button").all();
    const buttonBoxes = await Promise.all(
      mapButtons.map((button) => button.boundingBox()),
    );
    for (const bounds of buttonBoxes) {
      expect(bounds!.width).toBeGreaterThanOrEqual(44);
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
    }
    expect(buttonBoxes[1]!.y).toBeGreaterThan(buttonBoxes[0]!.y);
    await page.screenshot({
      path: `artifacts/atlas-layout/global-${viewport.width}x${viewport.height}.png`,
    });

    const input = search.getByRole("textbox", { name: /Search places and routes/ });
    await input.focus();
    await expect(
      search.getByRole("listbox", { name: "Browse route regions" }),
    ).toBeVisible();
    await input.press("Escape");
    await expect(
      page.getByRole("button", { name: "Open Atlas options" }),
    ).toBeFocused();
    await page.getByRole("button", { name: "Open Atlas options" }).click();
    await search
      .getByRole("option", { name: "Kyoto, Japan", exact: true }).click();
    await expect(page).toHaveURL(/region=Kyoto%2C\+Japan/);
    await expect(
      page.getByRole("button", { name: "Open Atlas options" }),
    ).toBeVisible();
    const carousel = page.getByRole("region", {
      name: "Kyoto, Japan routes",
      exact: true,
    });
    await expect(
      carousel.getByRole("heading", {
        name: "Kyoto, Japan",
        exact: true,
        level: 2,
      }),
    ).toBeVisible();
    const carouselBox = (await carousel.boundingBox())!;
    const toolsBox = (await tools.boundingBox())!;
    const searchBox = (await search.boundingBox())!;
    expect(toolsBox.y).toBeGreaterThanOrEqual(0);
    expect(toolsBox.y + toolsBox.height).toBeLessThanOrEqual(carouselBox.y);
    expect(searchBox.y + searchBox.height).toBeLessThanOrEqual(carouselBox.y);
    expect(
      searchBox.x + searchBox.width <= toolsBox.x ||
        searchBox.y + searchBox.height <= toolsBox.y,
    ).toBe(true);
    await page.screenshot({
      path: `artifacts/atlas-layout/region-${viewport.width}x${viewport.height}.png`,
    });
  });
}

test("mobile Atlas options provide Admin without a fifth primary tab", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/atlas");
  const navigation = page.getByTestId("atlas-spine-mobile");
  await expect(navigation.getByRole("link")).toHaveCount(4);
  await page.getByRole("button", { name: "Open Atlas options" }).click();
  await page.getByRole("link", { name: "Admin", exact: true }).click();
  await expect(page).toHaveURL(/#\/admin$/);
  await navigation.getByRole("link", { name: "Atlas", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open Atlas options" }),
  ).toBeVisible();
});

test("Ember activity selection separates pointer and keyboard focus", async ({ page }) => {
  await page.goto("/#/atlas");
  const runs = page.getByRole("button", { name: "Show runs", exact: true });
  await runs.click();
  await expect(runs).toHaveAttribute("aria-pressed", "true");
  await expect(runs).toHaveCSS("box-shadow", "none");
  await expect(runs).toHaveCSS("border-width", "0px");
  expect(await runs.evaluate(el => el.matches(":focus-visible"))).toBe(false);
  await runs.press("Tab");
  const rides = page.getByRole("button", { name: "Show rides", exact: true });
  await expect(rides).toBeFocused();
  await rides.press("Space");
  await expect(rides).toHaveAttribute("aria-pressed", "true");
  await expect(rides).toHaveCSS("outline-width", "2px");
  await expect(rides).toHaveCSS("outline-offset", "-3px");
  await expect(rides).toHaveCSS("box-shadow", "none");
});
