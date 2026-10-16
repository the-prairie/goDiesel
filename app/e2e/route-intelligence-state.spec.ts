import { expect, test } from "@playwright/test";

const url = "/#/lab/route-intelligence";
const first = "14736711660";
const second = "14023448720";
const failure = "One or more field-test routes could not be loaded.";

for (const missing of [first, second]) {
  test(`partial route intelligence keeps the surviving field test when ${missing} is missing`, async ({ page }) => {
    await page.route(`**/data/routes/${missing}.json`, route => route.fulfill({ status: 404 }));
    await page.goto(url);
    await expect(page.getByTestId("route-intelligence-lab")).toBeVisible();
    await expect(page.getByTestId(`route-genome-${missing === first ? second : first}`)).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    if (missing === first) {
      await expect(page.locator('[data-testid^="journey-strip-"]')).toHaveCount(0);
      await page.getByRole("button", { name: "Crete", exact: true }).click();
      await expect(page.getByTestId(`journey-strip-${second}`)).toBeVisible();
    } else {
      await expect(page.getByTestId(`journey-strip-${first}`)).toBeVisible();
    }
  });
}

for (const status of [404, 503]) {
  test(`route intelligence displays its existing empty alert for HTTP ${status}`, async ({ page }) => {
    await page.route("**/data/routes/*.json", route => route.fulfill({ status }));
    await page.goto(url);
    await expect(page.getByRole("alert")).toHaveText(failure);
    await expect(page.getByRole("status")).toHaveCount(0);
  });
}

test("route intelligence renders derived genomes when enrichment fails", async ({ page }) => {
  await page.route("**/data/route-intelligence/*.json", route => route.fulfill({ status: 503 }));
  await page.goto(url);
  await expect(page.getByTestId(`route-genome-${first}`)).toBeVisible();
  await expect(page.getByTestId(`route-genome-${second}`)).toBeVisible();
  await expect(page.getByText("Satellite observed", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Crete", exact: true }).click();
  await expect(page.getByRole("button", { name: "Crete", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("leaving a pending route-intelligence load prevents late content from replacing Finder", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/data/route-intelligence/*.json", async route => {
    await held;
    await route.fulfill({ status: 503 });
  });
  await page.goto(url);
  await expect(page.getByRole("status")).toHaveText("Reading both landscapes.");
  await page.getByRole("link", { name: "Finder", exact: true }).click();
  release();
  await expect(page).toHaveURL(/#\/finder$/);
  await expect(page.getByTestId("route-intelligence-lab")).toHaveCount(0);
});
