import { expect, test } from "@playwright/test";
for (const width of [390, 1280]) {
  test(`hybrid collection search and filters at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/#/finder");
    await page
      .getByRole("textbox", { name: "Describe your next route" })
      .fill("a run past Westminster and Kensington Gardens");
    await page
      .getByRole("button", { name: "Find routes", exact: true })
      .click();
    await expect(page.getByRole("article").first()).toHaveAccessibleName(
      "London, UK candidate",
    );
    await expect(page.getByRole("article").first().getByRole("heading")).not.toHaveText("London, UK");
    if (width < 1024) await page.getByRole("button", {name: "Map", exact: true}).click();
    await expect(
      page.getByRole("region", { name: "Finder route map" }),
    ).toHaveAttribute("data-map-status", "ready");
    await expect(page.getByLabel("Selected map route")).toContainText("London, UK");
    await expect(page.getByText("Keyword + related-theme search", {exact:true})).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: `artifacts/finder-search/collection-${width}.png`,
    });
    await page.getByRole("button", { name: "Edit filters" }).click();
    await page.getByRole("spinbutton", { name: "Maximum climb m" }).fill("100");
    await page
      .getByRole("button", { name: "Find routes", exact: true })
      .click();
    await expect(
      page.getByRole("article", { name: "London, UK candidate" }),
    ).toHaveCount(0);
    await page.reload();
    await expect(page.getByLabel("Active Finder filters")).toContainText(
      "100 m climbing",
    );
  });
}
test("external discovery renders real member sections and discloses unknowns", async ({
  page,
}) => {
  await page.route("**/api/discovery?**", (route) =>
    route.fulfill({
      json: {
        routes: [
          {
            id: "osm-123",
            name: "Mapped test trail",
            sourceUrl: "https://www.openstreetmap.org/relation/123",
            activity: "Run",
            lines: [
              [
                [-115.57, 51.17],
                [-115.56, 51.18],
              ],
              [
                [-115.55, 51.19],
                [-115.54, 51.2],
              ],
            ],
            distanceKm: 21,
            distanceKind: "mapped",
          },
        ],
      },
    }),
  );
  await page.goto("/#/finder?place=Kyoto&activity=Run&distance=20");
  await page.getByRole("button", { name: "Discover new routes" }).click();
  await page.getByRole("button", { name: "Search new routes" }).click();
  await expect(
    page.getByRole("article", { name: "Mapped test trail" }),
  ).toContainText("Climb unknown");
  await expect(page.getByRole("link", { name: "View source" })).toHaveAttribute(
    "href",
    "https://www.openstreetmap.org/relation/123",
  );
  await expect(
    page.getByRole("region", { name: "Finder route map" }),
  ).toHaveAttribute("data-selected-route", "osm-123");
  await expect(
    page.getByRole("button", { name: "Save planned route" }),
  ).toHaveCount(0);
});
test("external failure keeps collection usable and offers retry", async ({
  page,
}) => {
  await page.route("**/api/discovery?**", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Route discovery is temporarily unavailable." },
    }),
  );
  await page.goto("/#/finder?place=Kyoto&activity=Run&distance=21");
  await page.getByRole("button", { name: "Discover new routes" }).click();
  await page.getByRole("button", { name: "Search new routes" }).click();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await page.getByRole("button", { name: "My collection · 67" }).click();
  await expect(page.getByRole("article", {name:"Kyoto, Japan candidate"})).toBeVisible();
});
test("interpreted ranges are editable as ranges and remain hard limits", async ({
  page,
}) => {
  await page.goto("/#/finder");
  await page
    .getByLabel("Describe your next route")
    .fill("a run 10–15 km under 500 m climbing");
  await page.getByRole("button", { name: "Find routes", exact: true }).click();
  await expect(page.getByLabel("Active Finder filters")).toContainText(
    "10–15 km",
  );
  await page.getByRole("button", { name: "Edit distance target" }).click();
  await expect(
    page.getByRole("spinbutton", { name: "Distance from km" }),
  ).toHaveValue("10");
  await page.getByRole("spinbutton", { name: "Distance to km" }).fill("12");
  await page.getByRole("button", { name: "Find routes", exact: true }).click();
  await expect(page).toHaveURL(/min=10&max=12/);
  await expect(page.getByLabel("Active Finder filters")).toContainText(
    "10–12 km",
  );
});
