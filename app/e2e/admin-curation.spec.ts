import { expect, test, type Page, type Request, type Route } from "@playwright/test";

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

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`Admin exposes a bounded owner workspace and unmistakable dirty actions on ${viewport.name}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await mockEditableAdmin(page, () => undefined);
    await page.goto("/#/admin");

    const workspace = page.getByTestId("admin-workspace");
    const routeList = page.getByRole("complementary", { name: "Owner route list" });
    const editor = page.getByRole("region", { name: "Route curation editor" });
    const actionBar = page.getByTestId("curation-action-bar");
    await expect(workspace).toBeVisible();
    await expect(routeList).toBeVisible();
    await expect(editor).toBeVisible();
    await expect(actionBar).toHaveAttribute("data-dirty", "false");
    await expect(actionBar).toContainText("No unsaved changes");
    expect(await actionBar.evaluate((element) => getComputedStyle(element).position)).toBe(
      "sticky",
    );

    await editor.getByLabel("Vibe").fill("A deliberate owner-authored route note.");
    await expect(actionBar).toHaveAttribute("data-dirty", "true");
    await expect(actionBar).toContainText("Unsaved changes");

    if (viewport.name === "desktop") {
      const listBox = await routeList.boundingBox();
      const editorBox = await editor.boundingBox();
      expect(listBox).not.toBeNull();
      expect(editorBox).not.toBeNull();
      expect(listBox!.x + listBox!.width).toBeLessThanOrEqual(editorBox!.x + 1);
      await page.screenshot({
        path: "e2e/evidence/issue-62-admin-workspace/admin-desktop.png",
      });
    } else {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: "e2e/evidence/issue-62-admin-workspace/admin-mobile.png",
      });
      await actionBar.scrollIntoViewIfNeeded();
      const actionBox = await actionBar.boundingBox();
      const navigationBox = await page.getByTestId("atlas-spine-mobile").boundingBox();
      expect(actionBox).not.toBeNull();
      expect(navigationBox).not.toBeNull();
      expect(actionBox!.y + actionBox!.height).toBeLessThanOrEqual(navigationBox!.y + 1);
      await page.screenshot({
        path: "e2e/evidence/issue-62-admin-workspace/admin-mobile-actions.png",
      });
    }
  });
}

test("Admin is explicitly read-only without the local writer", async ({
  page,
}) => {
  await page.route(`${adminApi}/**`, (route) => route.abort());
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


test("drafts survive filtering and selection while clearing search restores the preferred route", async ({ page }) => {
  await mockEditableAdmin(page, () => undefined);
  await page.route(`${adminApi}/api/routes`, (route) => route.fulfill({ json: [
    { ...adminRoute, activity_id: "a", name: "Calgary River Path", region: "Calgary" },
    { ...adminRoute, activity_id: "b", name: "Kyoto Temple Climb" },
  ] }));
  await page.goto("/#/admin");
  const editor = page.getByRole("region", { name: "Route curation editor" });
  const search = page.getByRole("searchbox", { name: "Search owner routes" });
  await editor.getByLabel("Vibe").fill("Calgary draft retained.");
  await search.fill("Kyoto");
  await editor.getByLabel("Vibe").fill("Kyoto draft retained.");
  await search.fill("");
  await expect(editor.getByRole("heading")).toHaveText("Calgary River Path");
  await expect(editor.getByLabel("Vibe")).toHaveValue("Calgary draft retained.");
  await page.getByRole("button", { name: /Kyoto Temple Climb/ }).click();
  await expect(editor.getByLabel("Vibe")).toHaveValue("Kyoto draft retained.");
  await search.fill("Calgary");
  await search.fill("");
  await expect(editor.getByRole("heading")).toHaveText("Kyoto Temple Climb");
  await expect(editor.getByLabel("Vibe")).toHaveValue("Kyoto draft retained.");
});

test("concurrent saves retain captured drafts and independent failure and retry feedback", async ({ page }) => {
  const saves: Route[] = [];
  await mockEditableAdmin(page, () => undefined);
  await page.route(`${adminApi}/api/routes`, (route) => route.fulfill({ json: [
    { ...adminRoute, activity_id: "a", name: "Calgary River Path", region: "Calgary", generation_status: "failed" },
    { ...adminRoute, activity_id: "b", name: "Kyoto Temple Climb" },
  ] }));
  await page.route(`${adminApi}/api/curation/save`, (route) => { saves.push(route); });
  await page.clock.install();
  await page.goto("/#/admin");
  const editor = page.getByRole("region", { name: "Route curation editor" });
  const save = editor.getByRole("button", { name: "Save and regenerate" });
  const actionBar = page.getByTestId("curation-action-bar");
  await expect(actionBar).toHaveAttribute("data-dirty", "false");
  await expect(save).toBeEnabled();
  await editor.getByLabel("Vibe").fill("Captured Calgary draft.");
  await save.click();
  await expect.poll(() => saves.length).toBe(1);
  await expect(editor.getByLabel("Vibe")).toBeDisabled();
  await page.clock.fastForward(120_000);
  await expect(editor.getByRole("button", { name: "Saving and rebuilding..." })).toBeDisabled();
  await page.getByRole("button", { name: /Kyoto Temple Climb/ }).click();
  await expect(editor.getByLabel("Vibe")).toBeEnabled();
  await editor.getByLabel("Vibe").fill("Captured Kyoto draft.");
  await save.click();
  await expect.poll(() => saves.length).toBe(2);
  expect(saves.map((route) => route.request().postDataJSON())).toMatchObject([
    { activity_id: "a", curation: { vibe: "Captured Calgary draft." } },
    { activity_id: "b", curation: { vibe: "Captured Kyoto draft." } },
  ]);
  await saves[0].fulfill({ json: { ok: true } });
  await expect(editor.getByRole("button", { name: "Saving and rebuilding..." })).toBeDisabled();
  await saves[1].fulfill({ status: 500, json: { error: "Fixture regeneration failed." } });
  await expect(editor.getByText("Fixture regeneration failed.")).toBeVisible();
  await expect(editor.getByLabel("Vibe")).toBeEnabled();
  await expect(actionBar).toHaveAttribute("data-dirty", "true");
  await page.getByRole("button", { name: /Calgary River Path/ }).click();
  await expect(actionBar).toHaveAttribute("data-dirty", "false");
  await expect(editor.getByText("Manifest and route detail regenerated")).toBeVisible();
  await expect(editor.getByLabel("Vibe")).toHaveValue("Captured Calgary draft.");
  await page.getByRole("button", { name: /Kyoto Temple Climb/ }).click();
  await expect(editor.getByText("Fixture regeneration failed.")).toBeVisible();
  await editor.getByLabel("Vibe").fill("Retry Kyoto draft.");
  await expect(editor.getByText("Fixture regeneration failed.")).toHaveCount(0);
  await save.click();
  await expect.poll(() => saves.length).toBe(3);
  expect(saves[2].request().postDataJSON().curation.vibe).toBe("Retry Kyoto draft.");
  await saves[2].fulfill({ json: { ok: true } });
  await expect(actionBar).toHaveAttribute("data-dirty", "false");
});

test("failed writer probe and bundled detail stay read-only without automatic retry", async ({ page }) => {
  let probes = 0;
  await page.route(`${adminApi}/**`, (route) => {
    probes += 1;
    return route.abort();
  });
  await page.route("**/data/routes/*.json", (route) => route.abort());
  await page.goto("/#/admin");
  await expect(page.getByText("Read-only mode.")).toBeVisible();
  const editor = page.getByRole("region", { name: "Route curation editor" });
  await expect(editor.getByLabel("Vibe")).toBeDisabled();
  await expect(editor.getByRole("heading")).not.toBeEmpty();
  await expect(editor.getByRole("button", { name: "Save and regenerate" })).toHaveCount(0);
  await page.getByRole("searchbox").fill("no matching route");
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(editor.getByLabel("Vibe")).toBeDisabled();
  expect(probes).toBe(2);
});


for (const width of [390, 1280]) {
  test(`list fields preserve typed newlines and save their parsed values at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    let saveRequest: Request | undefined;
    await mockEditableAdmin(page, (request) => { saveRequest = request; });
    await page.route(`${adminApi}/api/routes`, (route) => route.fulfill({ json: [
      { ...adminRoute, activity_id: "a", name: "Calgary River Path", region: "Calgary" },
      { ...adminRoute, activity_id: "b", name: "Kyoto Temple Climb" },
    ] }));
    await page.goto("/#/admin");
    const editor = page.getByRole("region", { name: "Route curation editor" });
    const terrain = editor.getByLabel("Terrain");
    await terrain.pressSequentially("Paved");
    await terrain.press("Enter");
    await terrain.press("Enter");
    await terrain.pressSequentially("Hills");
    await page.screenshot({ path: `artifacts/state-migration/t07/typed-terrain-${width}.png` });
    await expect(terrain).toHaveValue("Paved\n\nHills");
    for (let index = 0; index < 5; index += 1) await terrain.press("ArrowLeft");
    await terrain.pressSequentially("Steep ");
    await expect(terrain).toHaveValue("Paved\n\nSteep Hills");
    await editor.getByRole("button", { name: "Save and regenerate" }).click();
    await expect(editor.getByText("Manifest and route detail regenerated")).toBeVisible();
    expect(saveRequest!.postDataJSON().curation.terrain).toEqual(["Paved", "Steep Hills"]);
    await expect(page.getByTestId("curation-action-bar")).toHaveAttribute("data-dirty", "false");
    await page.getByRole("button", { name: /Kyoto Temple Climb/ }).click();
    await expect(editor.getByLabel("Terrain")).toHaveValue("");
    await page.getByRole("button", { name: /Calgary River Path/ }).click();
    await expect(editor.getByLabel("Terrain")).toHaveValue("Paved\nSteep Hills");
    const search = page.getByRole("searchbox");
    await search.fill("no matching route");
    await page.getByRole("button", { name: "Clear search" }).click();
    await expect(editor.getByLabel("Terrain")).toHaveValue("Paved\nSteep Hills");
  });
}


test("read-only list fields hydrate from bundled detail after their initial summary", async ({ page }) => {
  let detail: Route | undefined;
  await page.route(`${adminApi}/**`, (route) => route.abort());
  await page.route("**/data/routes/*.json", (route) => { detail = route; });
  await page.goto("/#/admin");
  const terrain = page.getByRole("region", { name: "Route curation editor" }).getByLabel("Terrain");
  await expect(terrain).toBeDisabled();
  await expect(terrain).toHaveValue("");
  await expect.poll(() => detail).toBeTruthy();
  const response = await detail!.fetch();
  const body = await response.json();
  body.curation.terrain = ["Bundled streets", "Bundled hills"];
  await detail!.fulfill({ json: body });
  await expect(terrain).toHaveValue("Bundled streets\nBundled hills");
  await expect(terrain).toBeDisabled();
});
