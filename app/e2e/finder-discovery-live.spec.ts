import { expect, test } from "@playwright/test";
test.skip(
  !process.env.GODIESEL_FINDER_LIVE,
  "Explicit live discovery verification",
);
for (const width of [390, 1280]) {
  test(`live source discovery and map controls at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width, height: 900 });
    await page.goto(
      "/#/finder?place=Banff&activity=Run&distance=10&max=10&scope=new&q=a+woodland+run+near+Banff+under+10+km",
    );
    await page
      .getByRole("button", { name: "Search new routes", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Banff, Alberta, Canada", exact: true })
      .click();
    const first = page.getByRole("article").first();
    await expect(first).toBeVisible({ timeout: 65_000 });
    await expect(first).toContainText("OpenStreetMap");
    await expect(first.getByRole("heading", { level: 3 })).not.toBeEmpty();
    await expect(first).toContainText(
      /Mapped loop|Open path|Branching paths|Disconnected sections/,
    );
    const source = first.getByRole("link", { name: "View source" });
    await expect(source).toHaveAttribute(
      "href",
      /^https:\/\/www.openstreetmap.org\/relation\/\d+$/,
    );
    if (width < 1024) await page.getByRole("button", { name: "Map", exact: true }).click();
    const map = page.getByRole("region", { name: "Finder route map" });
    await expect(map).toHaveAttribute("data-map-status", "ready", {
      timeout: 20_000,
    });
    for (const label of [
      "Zoom planning map in",
      "Zoom planning map out",
      "Fit route to map",
    ])
      await page.getByRole("button", { name: label }).click();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: `artifacts/finder-search/discovery-${width}.png`,
    });
    if (width < 1024) await page.getByRole("button", { name: "List", exact: true }).click();
    await first.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `artifacts/finder-search/discovery-cards-${width}.png`,
    });
    const planName = await first.getByRole("heading", { level: 3 }).innerText();
    await first
      .getByRole("button", { name: "Save as planned", exact: true })
      .click();
    await expect(
      first.getByRole("button", { name: "Saved to plans" }),
    ).toBeDisabled();
    await first.getByRole("link", { name: "View planned routes" }).click();
    await page.reload();
    const plan = page.getByRole("article", {
      name: `Planned discovery ${planName}`,
    });
    await expect(plan).toBeVisible();
    await plan.getByRole("button", { name: "Preview plan" }).click();
    await expect(
      page.getByRole("region", { name: "Finder route map" }),
    ).toHaveAttribute("data-map-status", "ready");
    await plan.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `artifacts/finder-search/saved-plan-${width}.png`,
    });
    await plan.getByRole("button", { name: "Remove plan" }).click();
    await expect(plan).toHaveCount(0);
  });
}
