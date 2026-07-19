import { expect, test } from "@playwright/test";

test("field-guide fixture exposes the approved semantic foundation", async ({
  page,
}) => {
  await page.goto("/#/lab/design-system");

  const fixture = page.getByTestId("field-guide-foundation");
  await expect(
    page.getByRole("heading", { name: "Field guide foundation" }),
  ).toBeVisible();
  await expect(fixture).toHaveCSS("color-scheme", "light");

  const tokens = await fixture.evaluate((element) => {
    const styles = getComputedStyle(element);
    return {
      canvas: styles.getPropertyValue("--canvas").trim(),
      forest: styles.getPropertyValue("--forest").trim(),
      route: styles.getPropertyValue("--route").trim(),
      coral: styles.getPropertyValue("--coral").trim(),
      primary: styles.getPropertyValue("--primary").trim(),
      interfaceFont: styles.getPropertyValue("--font-interface").trim(),
      editorialFont: styles.getPropertyValue("--font-editorial").trim(),
    };
  });

  expect(tokens).toEqual({
    canvas: "#f5f4ef",
    forest: "#0e4039",
    route: "#3379df",
    coral: "#d95737",
    primary: "#0e4039",
    interfaceFont: '"Inter Variable", Inter, system-ui, sans-serif',
    editorialFont: '"Cormorant Garamond", Georgia, serif',
  });

  const primaryAction = page.getByRole("button", { name: "Start route" });
  await expect(primaryAction).toBeEnabled();
  await expect(primaryAction).toHaveCSS("min-height", "44px");
  const activeAction = page.getByRole("button", { name: "Active route" });
  await expect(activeAction).toHaveAttribute("aria-pressed", "true");
  await expect(activeAction).toHaveCSS("background-color", "rgb(8, 47, 42)");
  const iconAction = page.getByRole("button", { name: "Route information" });
  await expect(iconAction).toHaveCSS("min-width", "44px");
  await expect(iconAction).toHaveCSS("min-height", "44px");
  await expect(page.getByRole("button", { name: "Saving route" })).toBeDisabled();
  await expect(page.getByLabel("Route search error")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  const waypoint = page
    .getByLabel("Selected route cartography example")
    .locator("circle");
  await expect(waypoint).toHaveAttribute("r", "14");
  await expect(waypoint).toHaveAttribute("stroke-width", "2");
  await expect(
    page.getByLabel("Selected route cartography example").locator("text"),
  ).toHaveText("1");
});

test("field-guide fixture is responsive and honors reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });

  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
    { width: 320, height: 568 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/#/lab/design-system");

    const layout = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      clippedFixtureElements: Array.from(
        document.querySelectorAll<HTMLElement>(
          '[data-testid="field-guide-foundation"] [data-clipping-check]',
        ),
      )
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return (
            element.scrollWidth > element.clientWidth + 1 ||
            rect.left < -1 ||
            rect.right > window.innerWidth + 1
          );
        })
        .map((element) => element.dataset.clippingCheck),
    }));
    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
    expect(layout.clippedFixtureElements).toEqual([]);
    await expect(page.getByTestId("foundation-skeleton")).toHaveCSS(
      "animation-name",
      "none",
    );
  }
});
