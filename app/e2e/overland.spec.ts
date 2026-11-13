import { expect, test, type Page } from "@playwright/test";

// The Overland lab: the pixel world map, the index, and one route's entry.
// Canvas pixels are presentation; everything a person can do is a real
// control with a name, and everything the canvas says has a text mirror.

const KYOTO = "Kyoto, Japan";
const GOLD = { slug: "17636880071", title: "i love goooooooolddddddddd" };
const PEACH = { slug: "17654151284", title: "🍑🍑🍑🍑💦💦💦💦" };

async function openWorld(page: Page, query = "") {
  await page.goto(`/#/lab/overland${query}`);
  await expect(page.getByTestId("overland")).toBeVisible();
  await expect(page.getByTestId("overland-world")).toBeVisible();
}

function town(page: Page, name: string) {
  return page.getByTestId("overland-towns").getByRole("button", { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")},`) });
}

test("the world map shows every place as a town a person can choose", async ({ page }) => {
  await openWorld(page);
  await expect(page.getByTestId("overland-towns").getByRole("button")).toHaveCount(29);
  const canvas = page.getByTestId("overland-world");
  await expect(canvas).toHaveJSProperty("width", 152);
  await expect(page.getByTestId("overland-world-text")).toContainText("29 towns");

  await town(page, KYOTO).click();
  await expect(town(page, KYOTO)).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(/town=Kyoto%2C(%20|\+)Japan/);
  await expect(page.getByTestId("overland-world-text")).toContainText(KYOTO);
  await expect(page.getByTestId("overland-world-text")).toContainText("2 routes");
});

test("a town's index lists its routes, and a route opens its entry with her words exactly", async ({ page }) => {
  await openWorld(page, `?town=${encodeURIComponent(KYOTO)}`);
  await page.getByRole("button", { name: "Index", exact: true }).click();
  const index = page.getByTestId("overland-index");
  await expect(index).toBeVisible();
  await expect(index.getByRole("button")).toHaveCount(2);

  await index.getByRole("button", { name: new RegExp(GOLD.title) }).click();
  await expect(page).toHaveURL(new RegExp(`#/lab/overland/${GOLD.slug}`));
  const entry = page.getByTestId("overland-entry");
  await expect(entry.getByRole("heading", { level: 1 })).toHaveText(GOLD.title);
  await expect(entry.getByTestId("overland-entry-text")).not.toBeEmpty();
  await expect(entry.getByTestId("overland-entry-text")).not.toContainText(/no note/i);
});

test("an emoji title is kept as written", async ({ page }) => {
  await page.goto(`/#/lab/overland/${PEACH.slug}`);
  await expect(page.getByTestId("overland-entry").getByRole("heading", { level: 1 })).toHaveText(PEACH.title);
});

test("a route without a note shows its place, date and distance", async ({ page }) => {
  // "Hittin the slopes" has no note.
  await page.goto("/#/lab/overland/17616195995");
  const text = page.getByTestId("overland-entry").getByTestId("overland-entry-text");
  await expect(text).toHaveText("Okayama, Japan · 21 Nov 2025 · 21.0 km");
});

test("Back from an entry returns to the same town and view", async ({ page }) => {
  await openWorld(page, `?town=${encodeURIComponent(KYOTO)}`);
  await page.getByRole("button", { name: "Index", exact: true }).click();
  await page.getByTestId("overland-index").getByRole("button", { name: new RegExp(GOLD.title) }).click();
  await expect(page.getByTestId("overland-entry")).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByTestId("overland-index")).toBeVisible();
  await expect(page).toHaveURL(/town=Kyoto/);
  await page.getByRole("button", { name: "Map", exact: true }).click();
  await expect(town(page, KYOTO)).toHaveAttribute("aria-pressed", "true");
});

test("the world, index and entry work from the keyboard alone", async ({ page }) => {
  await openWorld(page);
  await page.getByTestId("overland-world").focus();
  await page.keyboard.press("ArrowRight");
  const first = page.getByTestId("overland-towns").getByRole("button", { pressed: true });
  await expect(first).toHaveCount(1);
  // Enter on a town enters it in 3D; Escape comes back to the world.
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/lab\/overland\/town\//);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("overland-world")).toBeVisible();
  await page.getByRole("button", { name: "Index", exact: true }).click();
  await expect(page.getByTestId("overland-index")).toBeVisible();
  await page.getByTestId("overland-index").getByRole("button").first().focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("overland-entry")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("overland-index")).toBeVisible();
});

test("the full index lists every completed route, oldest as number one", async ({ page }) => {
  await page.goto("/#/lab/overland?view=index");
  const rows = page.getByTestId("overland-index").getByRole("button");
  await expect(rows).toHaveCount(66);
  await expect(rows.last()).toHaveAccessibleName(/^No\. 001,/);
});

for (const width of [390, 1440]) {
  test(`the lab fits a ${width}px viewport without horizontal scroll`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await openWorld(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    for (const button of await page.getByRole("button", { name: /^(Open|Map|Index|Previous town|Next town)$/ }).all()) {
      const box = await button.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }
  });
}
