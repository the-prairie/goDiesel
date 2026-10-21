import { expect, test } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";

const gpx = (name: string) =>
  `<?xml version="1.0"?><gpx version="1.1" creator="goDiesel test" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${name}</name><desc>Two recorded sections</desc><trkseg><trkpt lat="37.7694" lon="-122.4862"><ele>31</ele></trkpt><trkpt lat="37.7701" lon="-122.4828"><ele>34</ele></trkpt></trkseg><trkseg><trkpt lat="37.7712" lon="-122.4780"/><trkpt lat="37.7720" lon="-122.4730"/></trkseg></trk></gpx>`;
for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  test(`GPX upload, save, reopen and download at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/#/courses");
    await expect(
      page.getByRole("radio", { name: "Import GPX", exact: true }),
    ).toBeEnabled();
    await page.getByRole("radio", { name: "Import GPX", exact: true }).click();
    await page.getByRole("radio", { name: "Ride", exact: true }).click();
    const name = `Park sections ${viewport.width} ${Date.now()}`;
    await page.getByLabel("Upload GPX").setInputFiles({
      name: "park.gpx",
      mimeType: "application/gpx+xml",
      buffer: Buffer.from(gpx(name)),
    });
    const preview = page.getByRole("article", { name: "Course preview" });
    await expect(
      preview.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    await expect(preview).toContainText("2 separate sections");
    await expect(preview).toContainText("Elevation unavailable");
    await preview
      .getByRole("button", { name: "Save course", exact: true })
      .click();
    await expect(page).toHaveURL(/#\/courses\/course-/);
    await expect(preview).toContainText("Saved course");
    await expect(
      page.getByRole("region", { name: "Create a course", exact: true }),
    ).toHaveCount(0);
    await expect(
      preview.getByRole("link", { name: "Open 3D preview" }),
    ).toHaveAttribute("href", /#\/courses\/course-[^/]+\/preview$/);
    await page.reload();
    await expect(
      preview.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    await preview
      .getByText("Take this route to your Suunto Race S", { exact: true })
      .click();
    await expect(preview).toContainText("sync your Race S");
    const downloadEvent = page.waitForEvent("download");
    await preview
      .getByRole("button", { name: "Download GPX", exact: true })
      .click();
    const xml = await readFile((await (await downloadEvent).path())!, "utf8");
    expect(xml.match(/<trkseg>/g)).toHaveLength(2);
    expect(xml).toContain('lat="37.7694"');
    expect(xml).not.toContain("<time>");
    await page.getByRole("button", { name: "New route", exact: true }).click();
    await page.getByRole("link", { name: new RegExp(name) }).click();
    await expect(
      preview.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
}

test("drag and drop imports a GPX and malformed XML stays unsaved", async ({
  page,
}) => {
  await page.goto("/#/courses");
  await page.getByRole("radio", { name: "Import GPX", exact: true }).click();
  await expect(page.getByLabel("Upload GPX")).toBeEnabled();
  const transfer = await page.evaluateHandle(
    (xml) => {
      const data = new DataTransfer();
      data.items.add(
        new File([xml], "dropped.gpx", { type: "application/gpx+xml" }),
      );
      return data;
    },
    gpx(`Dropped GPX ${Date.now()}`),
  );
  await page
    .getByLabel("Upload GPX")
    .dispatchEvent("drop", { dataTransfer: transfer });
  await expect(
    page.getByRole("article", { name: "Course preview" }),
  ).toBeVisible();
  await page.getByLabel("Upload GPX").setInputFiles({
    name: "bad.gpx",
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(
      '<!DOCTYPE gpx [<!ENTITY foo SYSTEM "file:///etc/passwd">]><gpx>&foo;</gpx>',
    ),
  });
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/#\/courses$/);
});

test("existing collection GPX download is available", async ({ page }) => {
  await page.goto("/#/routes/14736711660");
  const button = page.getByRole("button", {
    name: "Download GPX",
    exact: true,
  });
  await expect(button).toBeVisible();
  const downloadEvent = page.waitForEvent("download");
  await button.click();
  const xml = await readFile((await (await downloadEvent).path())!, "utf8");
  expect(xml).toContain("<trkpt");
  expect(xml).toContain("just here for the zipper");
});

for (const [activity, viewport] of [
  ["Run", { width: 1440, height: 1000 }],
  ["Ride", { width: 390, height: 844 }],
] as const) {
  test(`live ${activity} generate, save and reopen with ${viewport.width}px clicks`, async ({
    page,
  }) => {
    test.skip(
      process.env.GODIESEL_LIVE_COURSES !== "1",
      "Requires real Photon and BRouter services",
    );
    await page.setViewportSize(viewport);
    await page.goto("/#/courses");
    await expect(
      page.getByRole("radio", { name: activity, exact: true }),
    ).toBeEnabled();
    await page.getByRole("radio", { name: activity, exact: true }).click();
    await page
      .getByLabel("Start near a place or landmark")
      .fill("Golden Gate Park, San Francisco");
    await page.getByRole("button", { name: "Find starting place" }).click();
    await page
      .getByLabel("Starting places")
      .getByRole("button")
      .first()
      .click();
    await page
      .getByLabel("Target distance", { exact: true })
      .fill(activity === "Ride" ? "12" : "5");
    await page
      .getByRole("button", { name: "Parks & green", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Generate route", exact: true })
      .click();
    const preview = page.getByRole("article", { name: "Course preview" });
    await expect(preview).toBeVisible({ timeout: 75_000 });
    await expect(preview.getByLabel("Finder route map")).toHaveAttribute(
      "data-map-status",
      "ready",
      { timeout: 25_000 },
    );
    await preview
      .getByRole("button", { name: "Save course", exact: true })
      .click();
    await expect(page).toHaveURL(/#\/courses\/course-/);
    await page.reload();
    await expect(preview).toContainText("Saved course");
    await expect(preview.getByLabel("Finder route map")).toHaveAttribute(
      "data-map-status",
      "ready",
      { timeout: 25_000 },
    );
    await preview.scrollIntoViewIfNeeded();
    await mkdir("artifacts/route-studio", { recursive: true });
    await page.screenshot({
      path: `artifacts/route-studio/${activity.toLowerCase()}-${viewport.width}.png`,
      fullPage: true,
    });
    const downloadEvent = page.waitForEvent("download");
    await preview
      .getByRole("button", { name: "Download GPX", exact: true })
      .click();
    await (
      await downloadEvent
    ).saveAs(`artifacts/route-studio/${activity.toLowerCase()}-browser.gpx`);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
}

for (const width of [1440, 390]) {
  test(`course choices support keyboard and busy state at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/api/discovery?place=*", (route) =>
      route.fulfill({
        json: { places: [{ name: "Test park", lat: 37.77, lng: -122.48 }] },
      }),
    );
    await page.goto("/#/courses");
    const run = page.getByRole("radio", { name: "Run", exact: true });
    await expect(run).toBeEnabled();
    await run.focus();
    await page.keyboard.down("ArrowRight");
    await expect(
      page.getByRole("radio", { name: "Walk", exact: true }),
    ).toBeFocused();
    await page.keyboard.up("ArrowRight");
    await expect(
      page.getByRole("radio", { name: "Walk", exact: true }),
    ).toBeChecked();
    await page.keyboard.down("ArrowRight");
    await expect(
      page.getByRole("radio", { name: "Ride", exact: true }),
    ).toBeFocused();
    await page.keyboard.up("ArrowRight");
    await expect(
      page.getByRole("radio", { name: "Ride", exact: true }),
    ).toBeChecked();
    await page.getByRole("radio", { name: "mi", exact: true }).click();
    await expect(
      page.getByRole("radio", { name: "mi", exact: true }),
    ).toBeChecked();
    await page.getByLabel("Start near a place or landmark").fill("Test park");
    await page.getByRole("button", { name: "Find starting place" }).click();
    await page.getByRole("button", { name: "Test park", exact: true }).click();
    let finish: (() => void) | undefined;
    await page.route("**/api/courses", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      await route
        .fulfill({ status: 503, json: { error: "Test provider unavailable" } })
        .catch(() => {});
    });
    await page
      .getByRole("button", { name: "Generate route", exact: true })
      .click();
    await expect(run).toBeDisabled();
    await expect(
      page.getByRole("radio", { name: "Import GPX", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    finish?.();
    await expect(run).toBeEnabled();
    await expect(
      page.getByRole("radio", { name: "Ride", exact: true }),
    ).toBeChecked();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(await page.locator("select").count()).toBe(0);
  });
}
