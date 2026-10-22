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
    await expect(page.getByText("Opening your courses…", { exact: true })).toHaveCount(0);
    const savedLink = page.getByRole("link", { name: new RegExp(name) });
    while (await savedLink.count() === 0) {
      await page.getByRole("button", { name: "Load more courses", exact: true }).click();
      await expect(page.getByText("Loading more courses…", { exact: true })).toHaveCount(0);
    }
    await savedLink.click();
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
      "Requires real Photon and configured routing services",
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
      .getByRole("button", { name: "Parks", exact: true })
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

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`summary pagination and independent course detail at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const detail = {
      id: "course-00000024-1111-4111-8111-111111111111",
      name: "Last page course",
      description: "Pagination fixture",
      activity: "Walk",
      createdAt: "2026-10-21T00:00:00Z",
      source: { kind: "gpx", filename: "fixture.gpx" },
      segments: [
        [
          { lat: 37.77, lng: -122.48 },
          { lat: 37.771, lng: -122.479 },
        ],
      ],
      distanceM: 142,
      ascentM: null,
      warnings: [],
    };
    const summaries = Array.from({ length: 25 }, (_, index) => ({
      id: `course-${String(index).padStart(8, "0")}-1111-4111-8111-111111111111`,
      name: index === 24 ? detail.name : `Saved route ${index + 1}`,
      activity: "Walk",
      createdAt: detail.createdAt,
      sourceKind: "gpx",
      distanceM: 142,
      ascentM: null,
      sectionCount: 1,
    }));
    const cursor = Buffer.from(`courses-v1:${summaries[23].id}`).toString(
      "base64url",
    );
    let listRequests = 0;
    let detailRequests = 0;
    let failList = false;
    await page.route("**/api/courses**", async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.has("id")) {
        detailRequests += 1;
        await route.fulfill({ json: { course: detail } });
      } else {
        listRequests += 1;
        if (failList)
          await route.fulfill({
            status: 503,
            json: { error: "Collection unavailable" },
          });
        else if (url.searchParams.get("cursor") === cursor)
          await route.fulfill({ json: { courses: summaries.slice(24) } });
        else
          await route.fulfill({
            json: { courses: summaries.slice(0, 24), cursor },
          });
      }
    });
    await page.goto("/#/courses");
    const library = page.getByRole("region", {
      name: "Saved courses",
      exact: true,
    });
    await expect(library.getByRole("link")).toHaveCount(24);
    await expect(library.getByRole("heading")).toContainText("24+");
    await library.getByRole("button", { name: "Load more courses" }).click();
    await expect(library.getByRole("link")).toHaveCount(25);
    await expect(
      library.getByRole("button", { name: "Load more courses" }),
    ).toHaveCount(0);
    await mkdir("artifacts/course-storage", { recursive: true });
    await page.screenshot({
      path: `artifacts/course-storage/pagination-${viewport.width}.png`,
      fullPage: true,
    });
    const completedListRequests = listRequests;
    failList = true;
    await library.getByRole("link", { name: new RegExp(detail.name) }).click();
    await expect(
      page.getByRole("heading", { name: detail.name, exact: true }),
    ).toBeVisible();
    expect(listRequests).toBe(completedListRequests);
    const completedDetailRequests = detailRequests;
    await page.reload();
    await expect(
      page.getByRole("heading", { name: detail.name, exact: true }),
    ).toBeVisible();
    expect(listRequests).toBe(completedListRequests);
    expect(detailRequests).toBeGreaterThan(completedDetailRequests);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
}

test("a saved result remains visible while its detail request is pending", async ({
  page,
}) => {
  const course = {
    id: "course-33333333-1111-4111-8111-111111111111",
    name: "Saved during navigation",
    description: "Save fixture",
    activity: "Run",
    createdAt: "2026-10-21T00:00:00Z",
    source: { kind: "gpx", filename: "fixture.gpx" },
    segments: [
      [
        { lat: 37.77, lng: -122.48 },
        { lat: 37.771, lng: -122.479 },
      ],
    ],
    distanceM: 142,
    ascentM: null,
    warnings: [],
  };
  let releaseDetail: (() => void) | undefined;
  const detailGate = new Promise<void>((resolve) => {
    releaseDetail = resolve;
  });
  await page.route("**/api/courses**", async (route) => {
    if (new URL(route.request().url()).searchParams.has("id")) {
      await detailGate;
      await route.fulfill({ json: { course } });
    } else if (route.request().method() === "POST")
      await route.fulfill({ json: { course } });
    else await route.fulfill({ json: { courses: [] } });
  });
  try {
    await page.goto("/#/courses");
    await page.getByRole("radio", { name: "Import GPX", exact: true }).click();
    await page
      .getByLabel("Upload GPX")
      .setInputFiles({
        name: "fixture.gpx",
        mimeType: "application/gpx+xml",
        buffer: Buffer.from(gpx("fixture")),
      });
    await page
      .getByRole("button", { name: "Save course", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(course.id));
    await expect(
      page.getByRole("heading", { name: course.name, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Download GPX", exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole("article", { name: "Course preview" }),
    ).toContainText("Saved course");
    releaseDetail!();
    await expect(
      page.getByText("Opening your courses…", { exact: true }),
    ).toHaveCount(0);
  } finally {
    releaseDetail!();
  }
});

for (const width of [1440, 390]) {
  test(`changing workspace credentials clears private course data at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const course = {
      id: "course-44444444-1111-4111-8111-111111111111",
      name: "Private course",
      description: "Credential boundary fixture",
      activity: "Run",
      createdAt: "2026-10-21T00:00:00Z",
      source: { kind: "gpx", filename: "private.gpx" },
      segments: [[{ lat: 37.77, lng: -122.48 }, { lat: 37.771, lng: -122.479 }]],
      distanceM: 142,
      ascentM: null,
      warnings: [],
    };
    await page.route("**/api/courses**", async route => {
      if (route.request().headers().authorization !== "Bearer fixture-owner") {
        await route.fulfill({ status: 401, json: { error: "Owner token required." } });
      } else await route.fulfill({ json: { course } });
    });
    await page.goto(`/#/courses/${course.id}`);
    await page.getByText("Agent access & workspace connection", { exact: true }).click();
    const ownerToken = page.getByLabel("Workspace owner token");
    const preview = page.getByRole("article", { name: "Course preview" });
    for (const action of ["Disconnect", "Connect"]) {
      await ownerToken.fill("fixture-owner");
      await page.getByRole("button", { name: "Connect", exact: true }).click();
      await expect(preview).toContainText(course.name);
      if (action === "Connect") await ownerToken.fill("different-owner");
      await page.getByRole("button", { name: action, exact: true }).click();
      await expect(page.getByRole("alert")).toContainText("Owner token required.");
      await expect(preview).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Download GPX", exact: true })).toHaveCount(0);
    }
  });
}
