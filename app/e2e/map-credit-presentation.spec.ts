import { expect, test } from "@playwright/test";

for (const width of [390, 1440]) {
  test(`map credits collapse after reading time and reopen by touch and keyboard at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route("https://tiles.openfreemap.org/styles/liberty", route => route.fulfill({ json: {
      version: 8,
      sources: { places: { type: "geojson", attribution: '<a href="https://openfreemap.org">OpenFreeMap</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', data: { type: "FeatureCollection", features: [] } } },
      layers: [{ id: "places", type: "circle", source: "places" }],
    } }));
    await page.goto("/#/routes/14394581660");
    const geography = page.getByRole("region", { name: "Route geography" });
    await expect(geography).toHaveAttribute("data-map-status", "ready");
    const credits = geography.locator(".maplibregl-ctrl-attrib");
    const link = credits.getByRole("link", { name: "OpenStreetMap", exact: true });
    await expect(link).toBeVisible();
    await expect(credits).not.toHaveClass(/maplibregl-compact-show/, { timeout: 8_000 });
    expect((await credits.boundingBox())!.width).toBeLessThanOrEqual(46);
    const toggle = credits.getByLabel("Toggle attribution");
    expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await toggle.click();
    await expect(link).toBeVisible();
    expect((await credits.boundingBox())!.x).toBeGreaterThanOrEqual(0);
    await toggle.press("Enter");
    await expect(link).toBeHidden();
    await toggle.press("Enter");
    await expect(link).toBeVisible();
    await page.getByRole("button", { name: "Zoom route map in", exact: true }).click();
    await expect(link).toBeVisible();
  });
}

test("reading map credits prevents automatic collapse", async ({ page }) => {
  await page.goto("/#/routes/14394581660");
  const geography = page.getByRole("region", { name: "Route geography" });
  await expect(geography).toHaveAttribute("data-map-status", "ready");
  const credits = geography.locator(".maplibregl-ctrl-attrib");
  await credits.getByLabel("Toggle attribution").focus();
  await page.waitForTimeout(5_500);
  await expect(credits.getByRole("link", { name: "OpenFreeMap", exact: true })).toBeVisible();
});

test("route gallery has one shared imagery credit instead of overlays", async ({ page }) => {
  await page.goto("/#/routes?page=2");
  await expect(page.locator(".route-cover").first()).toBeVisible();
  await expect(page.locator(".route-cover-credit")).toHaveCount(0);
  const credit = page.getByRole("link", { name: "Esri World Imagery", exact: true });
  await expect(credit).toHaveCount(1);
  await credit.scrollIntoViewIfNeeded();
  await expect(credit).toBeVisible();
  await page.locator(".field-note-link").first().click();
  await expect(page).toHaveURL(/#\/routes\/\d+/);
});
