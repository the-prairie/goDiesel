import { expect, test } from "@playwright/test";

test("live Google terrain, vector labels and atmospheric shaders render together", async ({ page }, testInfo) => {
  const evidence = { googleResponses: 0, vectorResponses: 0, errors: [] as string[] };
  page.on("response", (response) => {
    if (response.ok() && response.url().includes("tile.googleapis.com")) evidence.googleResponses += 1;
    if (response.ok() && /\.pbf|\.pmtiles/.test(response.url())) evidence.vectorResponses += 1;
  });
  page.on("pageerror", (error) => evidence.errors.push(error.message));
  await page.goto("/#/replay/14130782031?renderer=cinematic");
  expect(await page.evaluate(() => Boolean((window as unknown as { __GODIESEL_CINEMATIC_WORLD_FACTORY__?: unknown }).__GODIESEL_CINEMATIC_WORLD_FACTORY__))).toBe(false);
  const world = page.locator('[data-world-terrain="ready"]');
  await expect(world).toBeVisible({ timeout: 60_000 });
  await expect(world).toHaveAttribute("data-world-atmosphere", "ready", { timeout: 45_000 });
  await expect.poll(async () => Number(await world.getAttribute("data-world-label-count")), { timeout: 30_000 }).toBeGreaterThan(0);
  expect(evidence.googleResponses).toBeGreaterThan(1);
  expect(evidence.vectorResponses).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Play route", exact: true }).click();
  await expect.poll(async () => Number((await page.getByTestId("google-route-progress").textContent())?.split(" ")[0])).toBeGreaterThan(0.05);
  await page.screenshot({ path: testInfo.outputPath("cinematic-world-live.png") });
  await testInfo.attach("provider-evidence", { body: JSON.stringify(evidence, null, 2), contentType: "application/json" });
  expect(evidence.errors).toEqual([]);
});
