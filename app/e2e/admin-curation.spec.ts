import { expect, test, type Page, type Request } from "@playwright/test";

const adminApi = "http://127.0.0.1:8766";

const adminRoute = {
  activity_id: "17654151284",
  status: "approved",
  region: "Kyoto, Japan",
  auto_region: "Kyoto, Japan",
  name: "Kyoto, Japan",
  date: "2025-11-24",
  type: "Run",
  distance_km: 21.3,
  curation: {
    vibe: "Long city miles into a sustained climb.",
    review_status: "draft",
  },
  geometry_status: "ready",
  replay_eligible: true,
  generation_status: "ready",
};

async function mockEditableAdmin(
  page: Page,
  onSave: (request: Request) => void,
) {
  await page.route(`${adminApi}/api/admin/status`, async (route) => {
    await route.fulfill({
      json: {
        writer_available: true,
        mode: "local-owner",
        generation_status: "ready",
        generated_at: "2026-07-14T12:00:00",
      },
    });
  });
  await page.route(`${adminApi}/api/routes`, async (route) => {
    await route.fulfill({ json: [adminRoute] });
  });
  await page.route(`${adminApi}/api/curation/save`, async (route) => {
    onSave(route.request());
    await route.fulfill({
      json: {
        ok: true,
        activity_id: adminRoute.activity_id,
        generation_status: "ready",
      },
    });
  });
}

test("local owner workflow validates every field and regenerates route data", async ({
  page,
}) => {
  let saveRequest: Request | null = null;
  await mockEditableAdmin(page, (request) => {
    saveRequest = request;
  });
  await page.goto("/#/admin");

  await expect(page.getByText("Local owner writer connected.")).toBeVisible();
  const editor = page.getByRole("region", { name: "Route curation editor" });
  await expect(editor.getByText("Geometry")).toBeVisible();
  await expect(editor.getByText("Replay")).toBeVisible();
  await expect(editor.getByText("Generation")).toBeVisible();

  await editor.getByLabel("Review status").selectOption("reviewed");
  await expect(editor.getByRole("status")).toContainText(
    "Reviewed guides require every curation field",
  );
  await expect(
    editor.getByRole("button", { name: "Save and regenerate" }),
  ).toBeDisabled();

  await editor
    .getByLabel("Vibe")
    .fill("Quiet temple lanes opening into a sustained climb.");
  await editor.getByLabel("Ideal use").fill("A cool day with time to explore.");
  await editor.getByLabel("Difficulty").fill("Demanding");
  await editor.getByLabel("Terrain").fill("Paved lanes\nHills");
  await editor.getByLabel("Highlights").fill("Temple district\nEastern hills");
  await editor.getByLabel("Caveats").fill("Frequent road crossings");
  await editor.getByLabel("Seasonality").fill("Best in cool, dry weather.");
  await editor
    .getByLabel("Editorial note")
    .fill("Preserved for its city-to-hills contrast.");
  await expect(editor.getByRole("status")).toContainText(
    "Reviewed guide is complete and ready to generate",
  );

  await editor.getByRole("button", { name: "Save and regenerate" }).click();
  await expect(
    editor.getByText("Manifest and route detail regenerated"),
  ).toBeVisible();
  expect(saveRequest).not.toBeNull();
  expect(saveRequest!.postDataJSON()).toEqual({
    activity_id: "17654151284",
    curation: {
      vibe: "Quiet temple lanes opening into a sustained climb.",
      ideal_use: "A cool day with time to explore.",
      terrain: ["Paved lanes", "Hills"],
      difficulty: "Demanding",
      highlights: ["Temple district", "Eastern hills"],
      caveats: ["Frequent road crossings"],
      seasonality: "Best in cool, dry weather.",
      editorial_note: "Preserved for its city-to-hills contrast.",
      review_status: "reviewed",
    },
  });
});

test("Admin is explicitly read-only without the local writer", async ({
  page,
}) => {
  await page.goto("/#/admin");

  await expect(page.getByText("Read-only mode.")).toBeVisible();
  const editor = page.getByRole("region", { name: "Route curation editor" });
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel("Vibe")).toBeDisabled();
  await expect(editor.getByLabel("Review status")).toBeDisabled();
  await expect(
    editor.getByRole("button", { name: "Save and regenerate" }),
  ).toHaveCount(0);
  await expect(
    editor.getByText("ready", { exact: true }).first(),
  ).toBeVisible();
});

test("large owner libraries stay bounded while every route remains searchable", async ({
  page,
}) => {
  const records = Array.from({ length: 205 }, (_, index) => ({
    ...adminRoute,
    activity_id: `route-${index}`,
    name: `Route ${index}`,
    region: index === 204 ? "Hidden Valley" : "Kyoto, Japan",
  }));
  await page.route(`${adminApi}/api/admin/status`, (route) =>
    route.fulfill({
      json: { writer_available: true, generation_status: "ready" },
    }),
  );
  await page.route(`${adminApi}/api/routes`, (route) =>
    route.fulfill({ json: records }),
  );
  await page.goto("/#/admin");

  const routeList = page.getByRole("complementary", {
    name: "Owner route list",
  });
  await expect(routeList.getByRole("button")).toHaveCount(200);
  await expect(routeList).toContainText("Showing 200 of 205 routes");
  await routeList
    .getByRole("searchbox", { name: "Search owner routes" })
    .fill("Hidden Valley");
  await expect(routeList.getByRole("button")).toHaveCount(1);
  await expect(routeList.getByRole("button")).toContainText("Route 204");
});

test("save status stays with the route that initiated the request", async ({ page }) => {
  const records = [
    {
      ...adminRoute,
      activity_id: "calgary-route",
      name: "Calgary River Path",
      region: "Calgary, Canada",
    },
    {
      ...adminRoute,
      activity_id: "kyoto-route",
      name: "Kyoto Temple Climb",
      region: "Kyoto, Japan",
    },
  ];
  let releaseSave: (() => void) | undefined;
  let signalSaveStarted: (() => void) | undefined;
  const saveStarted = new Promise<void>((resolve) => {
    signalSaveStarted = resolve;
  });
  await page.route(`${adminApi}/api/admin/status`, (route) =>
    route.fulfill({
      json: { writer_available: true, generation_status: "ready" },
    }),
  );
  await page.route(`${adminApi}/api/routes`, (route) =>
    route.fulfill({ json: records }),
  );
  await page.route(`${adminApi}/api/curation/save`, async (route) => {
    signalSaveStarted?.();
    await new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    await route.fulfill({
      json: {
        ok: true,
        activity_id: "calgary-route",
        generation_status: "ready",
      },
    });
  });
  await page.goto("/#/admin");

  const search = page.getByRole("searchbox", { name: "Search owner routes" });
  const editor = page.getByRole("region", { name: "Route curation editor" });
  await editor.getByRole("button", { name: "Save and regenerate" }).click();
  await saveStarted;
  await search.fill("Kyoto");
  await expect(editor).toContainText("Kyoto Temple Climb");
  await editor.getByLabel("Vibe").fill("Unsaved Kyoto ridge notes.");
  releaseSave?.();
  await expect(editor.getByText("Manifest and route detail regenerated")).toHaveCount(0);
  await expect(editor.getByLabel("Vibe")).toHaveValue("Unsaved Kyoto ridge notes.");

  await search.fill("Calgary");
  await expect(editor).toContainText("Calgary River Path");
  await expect(editor.getByText("Manifest and route detail regenerated")).toBeVisible();
});

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`Admin search keeps the editor selection consistent on ${viewport.name}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const records = [
      {
        ...adminRoute,
        activity_id: "calgary-route",
        name: "Calgary River Path",
        region: "Calgary, Canada",
      },
      {
        ...adminRoute,
        activity_id: "kyoto-route",
        name: "Kyoto Temple Climb",
        region: "Kyoto, Japan",
      },
    ];
    await page.route(`${adminApi}/api/admin/status`, (route) =>
      route.fulfill({
        json: { writer_available: true, generation_status: "ready" },
      }),
    );
    await page.route(`${adminApi}/api/routes`, (route) =>
      route.fulfill({ json: records }),
    );
    await page.goto("/#/admin");

    const search = page.getByRole("searchbox", { name: "Search owner routes" });
    const editor = page.getByRole("region", { name: "Route curation editor" });
    await expect(editor).toContainText("Calgary River Path");

    await search.fill("Kyoto");
    await expect(editor).toContainText("Kyoto Temple Climb");
    await expect(editor).not.toContainText("Calgary River Path");

    await search.fill("No such route");
    await expect(page.getByText("No routes match this search.")).toBeVisible();
    await expect(editor).toHaveCount(0);

    await page.getByRole("button", { name: "Clear search" }).click();
    await expect(search).toHaveValue("");
    await expect(editor).toContainText("Calgary River Path");
  });
}

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`Admin owner workflow fits ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockEditableAdmin(page, () => undefined);
    await page.goto("/#/admin");
    await expect(
      page.getByRole("region", { name: "Route curation editor" }),
    ).toBeVisible();

    const layout = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }));
    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
  });
}
