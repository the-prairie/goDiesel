import { expect, test } from "@playwright/test";

const ROUTES = [
  { slug: "14736711660", label: "San Francisco" },
  { slug: "14023448720", label: "Crete" },
] as const;

for (const route of ROUTES) {
  test(`navigates the ${route.label} route in native Google 3D`, async ({
    page,
  }) => {
    test.skip(
      process.env.GODIESEL_LIVE_GOOGLE_3D_E2E !== "1",
      "Live Google 3D verification is opt-in.",
    );

    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await page.goto(`/#/lab/google-route-navigator/${route.slug}`);

    const navigator = page.getByTestId("google-route-navigator");
    await expect(navigator).toHaveAttribute("data-state", "ready", {
      timeout: 30_000,
    });
    await expect(page.locator("gmp-map-3d")).toBeVisible();
    await expect(page.locator("gmp-polyline-3d")).toHaveCount(1);
    await expect(page.getByTestId("google-route-controls")).toBeVisible();

    await page.getByRole("button", { name: "Play route" }).click();
    const progress = page.getByTestId("google-route-progress");
    await expect
      .poll(async () => Number((await progress.textContent())?.split(" ")[0]))
      .toBeGreaterThan(0);
    await page.getByRole("button", { name: "Pause route" }).click();

    await page.getByRole("button", { name: "Chase" }).click();
    await expect(navigator).toHaveAttribute("data-camera-mode", "chase");
    await page.getByRole("button", { name: "Overview" }).click();
    await expect(navigator).toHaveAttribute("data-camera-mode", "overview");

    await page.getByRole("button", { name: "Mesh" }).click();
    await expect(navigator).toHaveAttribute("data-grounding-mode", "mesh");
    await page.getByRole("button", { name: "Take manual control" }).click();
    await expect(navigator).toHaveAttribute("data-following", "false");
    await page.getByRole("button", { name: "Resume following" }).click();
    await expect(navigator).toHaveAttribute("data-following", "true");

    expect(
      consoleErrors.filter(
        (message) =>
          !message.includes("favicon") &&
          !message.includes("Failed to load resource"),
      ),
    ).toEqual([]);
  });
}

test("keeps the San Francisco navigator usable on a phone viewport", async ({
  page,
}) => {
  test.skip(
    process.env.GODIESEL_LIVE_GOOGLE_3D_E2E !== "1",
    "Live Google 3D verification is opt-in.",
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/lab/google-route-navigator/14736711660");

  const navigator = page.getByTestId("google-route-navigator");
  await expect(navigator).toHaveAttribute("data-state", "ready", {
    timeout: 30_000,
  });
  const controls = page.getByTestId("google-route-controls");
  await expect(controls).toBeVisible();

  const [navigatorBox, controlsBox] = await Promise.all([
    navigator.boundingBox(),
    controls.boundingBox(),
  ]);
  expect(navigatorBox).not.toBeNull();
  expect(controlsBox).not.toBeNull();
  expect((controlsBox?.x ?? 0) + (controlsBox?.width ?? 0)).toBeLessThanOrEqual(
    390,
  );
  expect((controlsBox?.y ?? 0) + (controlsBox?.height ?? 0)).toBeLessThanOrEqual(
    navigatorBox?.height ?? 0,
  );
  await expect(page.getByRole("button", { name: "Play route" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Chase" })).toBeVisible();
});
