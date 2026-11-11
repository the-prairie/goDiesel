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

test("a failed save keeps the preview and retries without reloading", async ({
  page,
}) => {
  const course = {
    id: "course-55555555-1111-4111-8111-111111111111",
    name: "Unsaved after failure",
    description: "Save failure fixture",
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
  let saveAttempts = 0;
  await page.route("**/api/courses**", async (route) => {
    const request = route.request();
    if (new URL(request.url()).searchParams.has("id"))
      return route.fulfill({ json: { course } });
    if (request.method() !== "POST")
      return route.fulfill({ json: { courses: [] } });
    if (request.postDataJSON()?.action !== "save")
      return route.fulfill({ json: { course } });
    saveAttempts += 1;
    if (saveAttempts === 1)
      return route.fulfill({
        status: 503,
        json: { error: "Course storage unavailable" },
      });
    return route.fulfill({ json: { course } });
  });
  await page.goto("/#/courses");
  await page.getByRole("radio", { name: "Import GPX", exact: true }).click();
  await page.getByLabel("Upload GPX").setInputFiles({
    name: "fixture.gpx",
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(gpx("fixture")),
  });
  const preview = page.getByRole("article", { name: "Course preview" });
  const save = preview.getByRole("button", { name: "Save course", exact: true });
  await save.click();
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Course storage unavailable");
  await expect(alert).toContainText("Your preview is still here");
  await expect(
    page.getByRole("button", { name: "Reload workspace", exact: true }),
  ).toHaveCount(0);
  await expect(preview).toContainText("Preview · not saved");
  await expect(
    preview.getByRole("heading", { name: course.name, exact: true }),
  ).toBeVisible();
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page).toHaveURL(new RegExp(course.id));
  await expect(preview).toContainText("Saved course");
  expect(saveAttempts).toBe(2);
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

const generatedCourse = {
  id: "course-66666666-1111-4111-8111-111111111111",
  name: "Generated test loop",
  description: "Generate fixture",
  activity: "Run",
  createdAt: "2026-10-21T00:00:00Z",
  source: {
    kind: "generated",
    provider: "brouter",
    profile: "foot",
    request: {
      start: { name: "Test park", lat: 37.77, lng: -122.48 },
      distance: 10,
      unit: "km",
      activity: "Run",
      vibes: [],
      seed: 0,
    },
  },
  segments: [
    [
      { lat: 37.77, lng: -122.48 },
      { lat: 37.775, lng: -122.475 },
      { lat: 37.77, lng: -122.47 },
      { lat: 37.77, lng: -122.48 },
    ],
  ],
  distanceM: 0,
  ascentM: null,
  warnings: [],
};

async function stubCourseStudio(
  page: import("@playwright/test").Page,
  options: { fail?: boolean } = {},
) {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let generateRequests = 0;
  await page.route("**/api/discovery?place=*", (route) =>
    route.fulfill({
      json: { places: [{ name: "Test park", lat: 37.77, lng: -122.48 }] },
    }),
  );
  await page.route("**/api/courses**", async (route) => {
    if (route.request().method() !== "POST")
      return route.fulfill({ json: { courses: [] } });
    generateRequests += 1;
    await gate;
    await route
      .fulfill(
        options.fail
          ? { status: 503, json: { error: "Test provider unavailable" } }
          : { json: { course: generatedCourse, receipt: "receipt-fixture" } },
      )
      .catch(() => {});
  });
  return { release: () => release(), generateRequests: () => generateRequests };
}

async function choosePlace(page: import("@playwright/test").Page) {
  await expect(page.getByRole("radio", { name: "Run", exact: true })).toBeEnabled();
  await page.getByLabel("Start near a place or landmark").fill("Test park");
  await page.getByRole("button", { name: "Find starting place" }).click();
  await page
    .getByLabel("Starting places")
    .getByRole("button", { name: "Test park", exact: true })
    .click();
}

for (const viewport of [
  { width: 390, height: 844 },
  { width: 320, height: 640 },
  { width: 844, height: 390 },
]) {
  test(`generating shows progress in view, then brings the preview into view and focus at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const studio = await stubCourseStudio(page);
    await page.goto("/#/courses");
    await choosePlace(page);
    await page.getByRole("button", { name: "Generate route", exact: true }).click();
    const progress = page.getByText(
      "Comparing loops and mapped features. This can take up to 45 seconds…",
      { exact: true },
    );
    await expect(progress).toBeInViewport({ ratio: 1 });
    await expect(
      page.getByRole("button", { name: "Generating route…", exact: true }),
    ).toBeVisible();
    studio.release();
    const heading = page
      .getByRole("article", { name: "Course preview" })
      .getByRole("heading", { name: generatedCourse.name, exact: true });
    await expect(heading).toBeFocused();
    await expect(heading).toBeInViewport({ ratio: 1 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });

  test(`a failed generate keeps the form usable and the error in view at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const studio = await stubCourseStudio(page, { fail: true });
    await page.goto("/#/courses");
    await choosePlace(page);
    await page.getByRole("button", { name: "Generate route", exact: true }).click();
    studio.release();
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("Test provider unavailable");
    await expect(alert).toBeInViewport();
    await expect(
      page.getByRole("button", { name: "Reload workspace", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByLabel("Start near a place or landmark")).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Generate route", exact: true }),
    ).toBeEnabled();
  });
}

test("the preview arriving does not move a desktop page where both columns are visible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Instant scrolling, so any progress reveal has finished before measuring.
  await page.emulateMedia({ reducedMotion: "reduce" });
  const studio = await stubCourseStudio(page);
  await page.goto("/#/courses");
  await choosePlace(page);
  await page.getByRole("button", { name: "Generate route", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Generating route…", exact: true }),
  ).toBeVisible();
  // The page title above both columns gives way to the preview, so the
  // browser's scroll anchoring may change scrollY; what must not move is the
  // control the person is looking at.
  const submit = page.getByRole("button", { name: /Generat(e|ing) route/ });
  const before = (await submit.boundingBox())!.y;
  studio.release();
  const heading = page
    .getByRole("article", { name: "Course preview" })
    .getByRole("heading", { name: generatedCourse.name, exact: true });
  await expect(heading).toBeFocused();
  await expect(heading).toBeInViewport({ ratio: 1 });
  await expect(submit).toHaveText("Generate route");
  expect(Math.abs((await submit.boundingBox())!.y - before)).toBeLessThanOrEqual(1);
});

test("Generate route says what it is waiting for, one reason at a time", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let releaseSearch: () => void = () => {};
  const searchGate = new Promise<void>((resolve) => {
    releaseSearch = resolve;
  });
  const studio = await stubCourseStudio(page);
  await page.route("**/api/discovery?place=*", async (route) => {
    await searchGate;
    await route.fulfill({
      json: { places: [{ name: "Test park", lat: 37.77, lng: -122.48 }] },
    });
  });
  await page.goto("/#/courses");
  await expect(page.getByRole("radio", { name: "Run", exact: true })).toBeEnabled();
  const generate = page.getByRole("button", { name: "Generate route", exact: true });
  const hint = page.locator("#course-generate-hint");
  await expect(generate).toBeDisabled();
  await expect(generate).toHaveAttribute("aria-describedby", "course-generate-hint");
  await expect(hint).toHaveText(
    "Enter a starting place, then choose it from the results.",
  );
  const field = page.getByLabel("Start near a place or landmark");
  await field.fill("Test park");
  await expect(page.getByText("Finding places…", { exact: true })).toBeVisible();
  await expect(hint).toHaveText(
    "Finding places. Choose one from the results to continue.",
  );
  releaseSearch();
  const choice = page
    .getByLabel("Starting places")
    .getByRole("button", { name: "Test park", exact: true });
  await expect(choice).toBeVisible();
  await expect(hint).toHaveText("Choose a starting place from the results.");
  await choice.click();
  await expect(generate).toBeEnabled();
  await expect(hint).toHaveCount(0);
  await expect(generate).not.toHaveAttribute("aria-describedby");
  const distance = page.getByLabel("Target distance", { exact: true });
  await distance.fill("0");
  await expect(generate).toBeDisabled();
  await expect(hint).toHaveText("Enter a distance between 1 and 100 km.");
  await distance.fill("5");
  await expect(generate).toBeEnabled();
  await field.press("Enter");
  await expect.poll(() => studio.generateRequests()).toBe(1);
  studio.release();
  await expect(
    page
      .getByRole("article", { name: "Course preview" })
      .getByRole("heading", { name: generatedCourse.name, exact: true }),
  ).toBeFocused();
});
