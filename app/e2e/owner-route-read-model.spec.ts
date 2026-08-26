import { expect, test } from "@playwright/test";

const adminApi = "http://127.0.0.1:8766";

function ownerRoute(lifecycle: "completed" | "discovered", activityName: string) {
  return {
    slug: `route-${lifecycle}`,
    route_id: `route-${lifecycle}`,
    identity_kind: "imported-route",
    source_kind: "owner-import",
    source_format: "gpx",
    lifecycle,
    name: "Calgary, AB",
    subtitle: activityName,
    activity_name: activityName,
    region: "Calgary, AB",
    date: lifecycle === "completed" ? "2026-08-01" : "",
    distance_km: 12,
    elevation_gain_m: 180,
    elevation_status: "recorded",
    type: "Run",
    description: "Owner-only route.",
    completion_rule: "Complete the route.",
    difficulty: "Moderate",
    theme: "Trail day",
    xp: 60,
    center_lat: 51.005,
    center_lng: -114.005,
    mid_idx: 1,
    route: [
      { lat: 51, lng: -114, elev: 1000, d: 0 },
      { lat: 51.01, lng: -114.01, elev: 1180, d: 12000 },
    ],
    replay: { mode: "atlas", replay_eligible: true, best_in_earth: false, geometry_status: "ready" },
    curation: { review_status: "draft", terrain: ["trail"], vibe: "quiet" },
    annotations: [],
    provenance: {
      temporal: { status: "unavailable" },
      elevation: { status: "recorded" },
      track: { segment_count: 1 },
      discontinuities: [],
    },
  };
}

test("owner-only completed and discovered routes reach Atlas and Finder", async ({ page }) => {
  const discovered = ownerRoute("discovered", "Private Future Line");
  await page.route(`${adminApi}/api/owner/routes`, (route) => route.fulfill({
    json: {
      routes: [
        ownerRoute("completed", "Private Alpine Memory"),
        discovered,
      ],
    },
  }));

  await page.goto("/#/atlas?q=Private%20Alpine");
  await expect(page.getByRole("button", { name: /Calgary, AB.*12\.0 km/ })).toBeVisible();

  await page.goto("/#/finder?place=Calgary&activity=Run&distance=12&terrain=trail");
  await expect(page.getByText("Private Future Line")).toBeVisible();
  await expect(page.getByText("Owner-curated route source")).toBeVisible();
  await expect(page.getByText("Private Alpine Memory")).toHaveCount(0);

  await page.route(`${adminApi}/api/owner/routes/route-discovered`, (route) => route.fulfill({
    json: discovered,
  }));
  await page.route("**/data/routes/route-discovered.json", (route) => route.fulfill({
    status: 404,
    body: "not found",
  }));
  await page.goto("/#/replay/route-discovered");
  await expect(page.getByText("Route unavailable")).toBeVisible();
  await expect(page.getByLabel("Google 3D Replay")).toHaveCount(0);
});
