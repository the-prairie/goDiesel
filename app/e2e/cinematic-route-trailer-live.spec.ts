import { expect, test } from "@playwright/test";

const ROUTES = [
  { slug: "14736711660", label: "San Francisco" },
  { slug: "14023448720", label: "Crete" },
] as const;

for (const route of ROUTES) {
  test(`previews ${route.label} as a cinematic route picture`, async ({
    page,
  }) => {
    test.skip(
      process.env.GODIESEL_LIVE_GOOGLE_3D_E2E !== "1",
      "Live Google 3D verification is opt-in.",
    );
    // A live photorealistic scene must stream tiles, settle, and play a preroll
    // before the decision is reachable. The 30 second default is a deterministic
    // budget; every other live spec allows minutes.
    test.setTimeout(180_000);

    await page.goto(`/#/lab/route-trailer/${route.slug}`);

    const trailer = page.getByTestId("route-trailer");
    await expect(trailer).toHaveAttribute("data-state", "ready", {
      timeout: 30_000,
    });
    await expect(page.locator("gmp-map-3d")).toBeVisible();
    await expect(page.locator("gmp-polyline-3d")).toHaveCount(1);
    await expect(page.getByTestId("route-trailer-chapter")).toBeVisible();

    const openingPathLength = await page
      .locator("gmp-polyline-3d")
      .evaluate((element) => {
        const polyline = element as HTMLElement & {
          path?: Array<unknown>;
        };
        return polyline.path?.length ?? 0;
      });
    expect(openingPathLength).toBeGreaterThanOrEqual(2);

    await page.getByRole("button", { name: "Skip" }).click();
    await expect(page.getByTestId("route-trailer-decision")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Enter the route" }),
    ).toHaveAttribute("href", `#/lab/google-route-navigator/${route.slug}`);

    const revealedPathLength = await page
      .locator("gmp-polyline-3d")
      .evaluate((element) => {
        const polyline = element as HTMLElement & {
          path?: Array<unknown>;
        };
        return polyline.path?.length ?? 0;
      });
    expect(revealedPathLength).toBeGreaterThan(openingPathLength);
  });
}

test("keeps the Crete trailer decision usable on a phone", async ({ page }) => {
  test.skip(
    process.env.GODIESEL_LIVE_GOOGLE_3D_E2E !== "1",
    "Live Google 3D verification is opt-in.",
  );
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/lab/route-trailer/14023448720");

  const trailer = page.getByTestId("route-trailer");
  await expect(trailer).toHaveAttribute("data-state", "ready", {
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Skip" }).click();
  const decision = page.getByTestId("route-trailer-decision");
  await expect(decision).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Enter the route" }),
  ).toBeVisible();

  const box = await decision.boundingBox();
  expect(box).not.toBeNull();
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(844);
});
