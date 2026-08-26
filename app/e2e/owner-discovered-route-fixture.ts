import type { Page } from "@playwright/test";

import kyotoRoute from "../public/data/routes/17654151284.json" with { type: "json" };

export const ownerDiscoveredRouteSlug = "route-private-kyoto";

const ownerDiscoveredRoute = {
  ...kyotoRoute,
  slug: ownerDiscoveredRouteSlug,
  route_id: ownerDiscoveredRouteSlug,
  activity_id: undefined,
  identity_kind: "imported-route",
  source_kind: "owner-import",
  source_format: "gpx",
  lifecycle: "discovered",
  date: "",
  provenance: {
    ...kyotoRoute.provenance,
    temporal: { status: "unavailable" },
  },
};

export async function installOwnerDiscoveredRoute(page: Page) {
  await page.route("http://127.0.0.1:8766/api/owner/routes", (route) =>
    route.fulfill({ json: { routes: [ownerDiscoveredRoute] } }),
  );
  await page.route(
    `http://127.0.0.1:8766/api/owner/routes/${ownerDiscoveredRouteSlug}`,
    (route) => route.fulfill({ json: ownerDiscoveredRoute }),
  );
}
