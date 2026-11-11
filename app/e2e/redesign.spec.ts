import { expect, test } from "@playwright/test";

for (const viewport of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 820, height: 900 },
  { width: 1440, height: 900 },
]) {
  test(`route guide and search controls fit ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/#/routes/17654151284");
    const margin = page.getByRole("complementary", { name: "Route margin" });
    const replay = page.getByRole("link", { name: "Open replay", exact: true });
    await expect(replay).toBeVisible();
    if (viewport.width < 768) {
      await page.getByRole("button", { name: "Expand route margin" }).click();
      await expect(margin).toHaveAttribute("data-snap", "expanded");
    }
    await expect(
      page.getByRole("img", { name: /🍑🍑🍑🍑💦💦💦💦 elevation profile/ }).locator("polyline"),
    ).toHaveCSS("stroke", "rgb(217, 217, 217)");
    const box = await margin.boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
    const replayBox = await replay.boundingBox();
    const navigationBox = await page.getByTestId("atlas-spine-mobile").boundingBox();
    expect(replayBox!.y + replayBox!.height).toBeLessThanOrEqual(
      navigationBox?.y ?? viewport.height,
    );
    await page.screenshot({
      path: `artifacts/redesign/guide-${viewport.width}.png`,
    });
    await page.goto("/#/finder");
    const form = page.getByRole("form", { name: "Find a route" });
    await expect(
      form.getByRole("button", { name: "Edit filters" }),
    ).toHaveAttribute("aria-expanded", "false");
    await expect(form.getByLabel("Terrain")).toBeHidden();
    await page.getByRole("button", { name: "Kyoto, Japan, 2 routes", exact: true }).click();
    await expect(
      page.getByRole("article", { name: "Kyoto, Japan candidate" }),
    ).toHaveCount(2);
    await expect(page).toHaveURL(/place=Kyoto/);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(viewport.width + 1);
  });
}

test("Atlas guide retains its source selection through guide and replay", async ({
  page,
}) => {
  const origin = "/atlas?region=Kyoto%2C+Japan&route=17654151284";
  await page.goto(`/#/routes/17654151284?from=${encodeURIComponent(origin)}`);
  await expect(
    page.getByRole("link", { name: "Back to Atlas", exact: true }),
  ).toHaveAttribute("href", `#${origin}`);
  await expect(
    page.getByRole("link", { name: "Open replay", exact: true }),
  ).toHaveAttribute(
    "href",
    `#/replay/17654151284?from=${encodeURIComponent(origin)}`,
  );
  await page.getByRole("link", { name: "Back to Atlas", exact: true }).click();
  await expect(page).toHaveURL(new RegExp("route=17654151284"));
});
