import { expect, test, type Page, type Route } from "@playwright/test";

const adminApi = "http://127.0.0.1:8766";

function stagedRoute(completed = false) {
  return {
    slug: "route-a1b2c3d4e5f6",
    route_id: "route-a1b2c3d4e5f6",
    identity_kind: "imported-route",
    source_kind: "owner-import",
    source_format: "gpx",
    lifecycle: completed ? "completed" : "discovered",
    name: "Calgary, AB",
    subtitle: "Synthetic ridge",
    activity_name: "Synthetic ridge",
    region: "Calgary, AB",
    date: completed ? "2026-08-01" : "",
    distance_km: 1.2,
    elevation_gain_m: 10,
    type: "Run",
    description: "",
    completion_rule: "Complete the route.",
    difficulty: "Easy",
    theme: "Wander Run",
    xp: 60,
    center_lat: 51.005,
    center_lng: -114.005,
    mid_idx: 1,
    route: [
      { lat: 51, lng: -114, elev: 1000, d: 0, ...(completed ? { elapsed_s: 0 } : {}) },
      { lat: 51.01, lng: -114.01, elev: 1010, d: 1200, ...(completed ? { elapsed_s: 600 } : {}) },
    ],
    replay: { mode: "atlas", replay_eligible: true, best_in_earth: false, geometry_status: "ready" },
    curation: { review_status: "draft" },
    annotations: [],
    provenance: {
      temporal: completed
        ? { status: "recorded", start_time_utc: "2026-08-01T14:00:00Z", elapsed_time_s: 600, time_zone: "America/Edmonton" }
        : { status: "unavailable" },
      elevation: { status: "recorded" },
      track: { segment_count: 1 },
      discontinuities: [],
    },
  };
}

function rawJob(options: { selected?: boolean; staged?: boolean; completed?: boolean; multiple?: boolean; status?: string; retryable?: boolean } = {}) {
  const candidates = [
    {
      id: "gpx-track-1", label: "North option", geometry_kind: "track", distance_m: 1200,
      ascent_m: 10, point_count: 2, segment_count: 1, elevation_status: "recorded",
      timing_status: options.completed ? "recorded" : "unavailable", geometry_fingerprint: "abc",
      preview_segments: [[[51, -114, 1000], [51.01, -114.01, 1010]]],
    },
    ...(options.multiple ? [{
      id: "gpx-track-2", label: "South option", geometry_kind: "track", distance_m: 1250,
      ascent_m: null, point_count: 2, segment_count: 1, elevation_status: "unavailable",
      timing_status: "unavailable", geometry_fingerprint: "def",
      preview_segments: [[[50.99, -114, null], [50.98, -114.01, null]]],
    }] : []),
  ];
  return {
    id: "job-abc", status: options.status ?? (options.staged ? "staged" : options.selected ? "needs_metadata" : "needs_geometry_selection"),
    selected_geometry_id: options.selected || options.staged ? "gpx-track-1" : null,
    retryable: options.retryable ?? false, cancellation_requested: false,
    source: { id: "src-abc", sha256: "a".repeat(64), original_filename: options.multiple ? "alternatives.kmz" : "ridge.gpx", stored_path: ".route-studio/source.gpx", source_format: options.multiple ? "kmz" : "gpx" },
    inspection: {
      source_format: options.multiple ? "kmz" : "gpx", candidates,
      findings: options.multiple ? [{ severity: "blocker", code: "multiple-geometries", message: "Select the intended route geometry before identifying this route." }] : [],
    },
    metadata: options.selected || options.staged ? { name: "Synthetic ridge", activity_type: "Run", completed_by_owner: options.completed ?? false, date: options.completed ? "2026-08-01" : "", region: "Calgary, AB", privacy: "private" } : null,
    staged_route: options.staged ? stagedRoute(options.completed) : null,
    events: [{ id: 1, level: "information", code: "source-inspected", message: "Source preserved and inspected.", created_at: "2026-08-22T00:00:00Z" }],
    render_attempts: options.status?.startsWith("render") ? [{ id: "render-1", status: options.status === "rendering" ? "running" : "failed", progress: options.status === "rendering" ? 0.42 : 0, output_path: null, render_fingerprint: "render" }] : [],
    errors: options.retryable ? [{ stage: "promotion", code: "canonical-generation-failed", message: "Canonical generation failed and was rolled back.", retryable: true }] : [],
  };
}

async function mockAdminStatus(page: Page, editable: boolean) {
  await page.route(`${adminApi}/api/admin/status`, (route) => route.fulfill({ json: editable ? { writer_available: true, mode: "local-owner", generation_status: "ready" } : {}, status: editable ? 200 : 503 }));
  await page.route(`${adminApi}/api/routes`, (route) => route.fulfill({ json: [], status: editable ? 200 : 503 }));
}

async function mockStudio(page: Page, initial: ReturnType<typeof rawJob>) {
  let job = structuredClone(initial);
  await page.route(`${adminApi}/api/studio/jobs`, (route) => route.fulfill({ json: [job] }));
  await page.route(`${adminApi}/api/studio/jobs/job-abc`, (route) => route.fulfill({ json: job }));
  await page.route(`${adminApi}/api/studio/jobs/job-abc/**`, async (route) => {
    const action = route.request().url().split("/").at(-1);
    if (action === "select-geometry") {
      job.selected_geometry_id = route.request().postDataJSON().candidate_id;
      job.status = "needs_metadata";
    } else if (action === "metadata") {
      job.metadata = route.request().postDataJSON();
      job.status = "ready_to_compile";
    } else if (action === "compile") {
      job.staged_route = stagedRoute(job.metadata?.completed_by_owner === true);
      job.status = "staged";
      return route.fulfill({ json: job.staged_route });
    } else if (action === "render") {
      job.status = "rendering";
      job.render_attempts = [{ id: "render-1", status: "running", progress: 0.42, output_path: null, render_fingerprint: "render" }];
    } else if (action === "retry") {
      job.status = "rendering";
      job.retryable = false;
    } else if (action === "promote") {
      if (job.retryable) {
        return route.fulfill({ status: 500, json: { error: "Canonical generation failed; promotion was rolled back and the staged route is intact." } });
      }
      job.status = "promoted";
    }
    await route.fulfill({ json: job });
  });
  return { current: () => job, replace: (next: typeof job) => { job = next; } };
}

test("editable local Admin exposes Route Studio while read-only Admin cannot upload", async ({ page }) => {
  await mockAdminStatus(page, true);
  await mockStudio(page, rawJob());
  await page.goto("/#/admin");
  await expect(page.getByRole("link", { name: "Route Studio" })).toBeVisible();

  await page.unrouteAll({ behavior: "wait" });
  await page.goto("/#/admin/studio");
  await expect(page.getByText("Route Studio is local-only")).toBeVisible();
  await expect(page.getByText("Drop a GPX, KML, or KMZ route")).toHaveCount(0);
});

test("drop GPX then inspect, identify, compile, and open truthful Preview", async ({ page }) => {
  await mockAdminStatus(page, true);
  const state = await mockStudio(page, rawJob({ selected: true }));
  await page.route(`${adminApi}/api/studio/sources`, (route) => route.fulfill({ status: 201, json: { job_id: "job-abc", exact_duplicate: false } }));
  await page.goto("/#/admin/studio");
  await page.locator('input[type="file"]').setInputFiles({ name: "ridge.gpx", mimeType: "application/gpx+xml", buffer: Buffer.from("<gpx />") });
  await expect(page).toHaveURL(/admin\/studio\/job-abc$/);
  await page.getByLabel("Route name").fill("Synthetic ridge");
  await page.getByLabel("Place or region").fill("Calgary, AB");
  await page.getByRole("button", { name: "Save route facts" }).click();
  await page.getByRole("button", { name: "Compile staged route" }).click();
  await expect(page.getByText("Preview · Cinematic timing")).toBeVisible();
  await expect(page.getByText("Owner-recorded timing")).toHaveCount(0);
  await page.getByRole("link", { name: "Open Route film" }).click();
  await expect(page).toHaveURL(/admin\/studio\/job-abc\/preview\?film=1$/);
  await expect(page.getByRole("link", { name: "Back to Route Studio" })).toHaveAttribute(
    "href",
    "#/admin/studio/job-abc",
  );
  await page.goto("/#/admin/studio/job-abc");
  if (process.env.GODIESEL_CAPTURE_STUDIO_EVIDENCE === "1") {
    await page.screenshot({
      path: "../docs/dogfood-reports/assets/route-studio/staged-preview.png",
      fullPage: true,
    });
  }
  expect(state.current().staged_route.lifecycle).toBe("discovered");
});

test("multi-route KMZ blocks metadata until explicit geometry selection", async ({ page }) => {
  await mockAdminStatus(page, true);
  await mockStudio(page, rawJob({ multiple: true }));
  await page.goto("/#/admin/studio/job-abc");
  await expect(page.getByText("Select the intended route geometry")).toBeVisible();
  await expect(page.getByLabel("Route name")).toHaveCount(0);
  if (process.env.GODIESEL_CAPTURE_STUDIO_EVIDENCE === "1") {
    await page.screenshot({
      path: "../docs/dogfood-reports/assets/route-studio/multiple-geometries.png",
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: /South option/ }).click();
  await expect(page.getByLabel("Route name")).toBeVisible();
});

test("completed route earns Replay language and future route falls back to Atlas Preview", async ({ page }) => {
  await mockAdminStatus(page, true);
  const studio = await mockStudio(page, rawJob({ staged: true, completed: true }));
  await page.goto("/#/admin/studio/job-abc");
  await expect(page.getByText("Replay · Owner-recorded timing")).toBeVisible();

  studio.replace(rawJob({ staged: true, completed: false }));
  await page.goto("/#/admin/studio/job-abc/preview");
  await expect(page.getByRole("button", { name: "Use Atlas preview" })).toBeVisible();
  await page.getByRole("button", { name: "Use Atlas preview" }).click();
  await expect(page.getByTestId("replay-stage")).toHaveAttribute("aria-label", "Atlas Preview");
});

test("render progress, retry, and failed promotion remain staged", async ({ page }) => {
  await mockAdminStatus(page, true);
  const studio = await mockStudio(page, rawJob({ staged: true, status: "render_failed", retryable: true }));
  await page.goto("/#/admin/studio/job-abc");
  await expect(page.getByText("Canonical generation failed and was rolled back.")).toBeVisible();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByTestId("route-studio-job")).toHaveAttribute("data-job-status", "rendering");
  expect(studio.current().staged_route).not.toBeNull();
});

test("promotion preserves the confirmed completed lifecycle", async ({ page }) => {
  await mockAdminStatus(page, true);
  const studio = await mockStudio(page, rawJob({ staged: true, completed: true }));
  await page.goto("/#/admin/studio/job-abc");
  await page.getByRole("button", { name: "Promote route" }).click();

  await expect(page.getByTestId("route-studio-job")).toHaveAttribute("data-job-status", "promoted");
  expect(studio.current().staged_route.lifecycle).toBe("completed");
});

test("failed promotion leaves the published Atlas response unchanged", async ({ page }) => {
  const published = [{ slug: "existing-route", lifecycle: "completed" }];
  await mockAdminStatus(page, true);
  await page.unroute(`${adminApi}/api/routes`);
  await page.route(`${adminApi}/api/routes`, (route) => route.fulfill({ json: published }));
  const studio = await mockStudio(page, rawJob({ staged: true, status: "promotion_failed", retryable: true }));
  await page.goto("/#/admin/studio/job-abc");
  await page.getByRole("button", { name: "Promote route" }).click();

  await expect(page.getByText(/promotion was rolled back/)).toBeVisible();
  const atlasResponse = await page.evaluate(async (url) => {
    const response = await fetch(url);
    return response.json();
  }, `${adminApi}/api/routes`);
  expect(atlasResponse).toEqual(published);
  expect(studio.current().staged_route.slug).toBe("route-a1b2c3d4e5f6");
});
