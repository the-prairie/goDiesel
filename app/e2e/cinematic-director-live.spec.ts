import { expect, test } from "@playwright/test";

const ROUTES = [
  { slug: "14736711660", label: "San Francisco" },
  { slug: "14023448720", label: "Crete" },
] as const;

for (const route of ROUTES) {
  test(`directs ${route.label} through the live photorealistic world`, async ({
    page,
  }) => {
    test.skip(
      process.env.GODIESEL_LIVE_GOOGLE_3D_E2E !== "1",
      "Live Google 3D verification is opt-in.",
    );

    await page.goto(`/#/lab/cinematic-director/${route.slug}`);
    const director = page.getByTestId("cinematic-director");
    await expect(director).toHaveAttribute("data-state", "ready", {
      timeout: 30_000,
    });
    await expect(page.locator("gmp-map-3d")).toBeVisible();
    await expect(page.locator("gmp-polyline-3d")).toHaveCount(1);
    await expect(page.getByTestId("cinematic-preroll")).toBeVisible();

    await page.getByRole("button", { name: /^Kinetic/ }).click();
    await expect(director).toHaveAttribute("data-cut", "kinetic");
    await page.getByRole("button", { name: "Play Kinetic cut" }).click();
    await expect(page.getByTestId("cinematic-chapter")).toBeVisible();

    const progress = page.getByTestId("cinematic-progress");
    await expect
      .poll(async () => Number(await progress.inputValue()))
      .toBeGreaterThan(0.01);

    await progress.focus();
    await page.keyboard.press("End");
    await expect(page.getByTestId("cinematic-decision")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Enter the route" }),
    ).toHaveAttribute("href", `#/lab/google-route-navigator/${route.slug}`);

    const routeColor = await page.locator("gmp-polyline-3d").evaluate((element) => {
      return (element as HTMLElement & { strokeColor?: string }).strokeColor;
    });
    expect(routeColor?.toLowerCase()).toBe("#f16c4b");
  });
}

test("keeps the Crete director decision usable on a phone", async ({ page }) => {
  test.skip(
    process.env.GODIESEL_LIVE_GOOGLE_3D_E2E !== "1",
    "Live Google 3D verification is opt-in.",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/lab/cinematic-director/14023448720");

  const director = page.getByTestId("cinematic-director");
  await expect(director).toHaveAttribute("data-state", "ready", {
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Play Monumental cut" }).click();
  const progress = page.getByTestId("cinematic-progress");
  await progress.focus();
  await page.keyboard.press("End");

  const decision = page.getByTestId("cinematic-decision");
  await expect(decision).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Enter the route" }),
  ).toBeVisible();
  const box = await decision.boundingBox();
  expect(box).not.toBeNull();
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(844);
});
