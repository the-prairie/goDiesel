import { describe, expect, it } from "vitest";

import { buildRouteRegions } from "@/data/route-regions";
import { completedRoutes } from "@/data/routes";
import { resolveAtlasSelection } from "@/domain/atlas-selection";

describe("resolveAtlasSelection", () => {
  const regions = buildRouteRegions(completedRoutes);
  const route = completedRoutes[0];

  it("resolves a route only inside its selected region", () => {
    const selection = resolveAtlasSelection(
      new URLSearchParams({ region: route.region, route: route.slug }),
      regions,
    );

    expect(selection.selectedRegion?.name).toBe(route.region);
    expect(selection.selectedRoute?.slug).toBe(route.slug);
    expect(selection.invalidRegion).toBe(false);
    expect(selection.invalidRoute).toBe(false);
  });

  it("marks unknown and cross-region route state invalid", () => {
    const otherRegion = regions.find((region) => region.name !== route.region)!;
    const selection = resolveAtlasSelection(
      new URLSearchParams({ region: otherRegion.name, route: route.slug }),
      regions,
    );

    expect(selection.selectedRegion?.name).toBe(otherRegion.name);
    expect(selection.selectedRoute).toBeUndefined();
    expect(selection.invalidRoute).toBe(true);
  });
});
