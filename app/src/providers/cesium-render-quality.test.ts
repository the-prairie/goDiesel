import { describe, expect, it } from "vitest";

import {
  CESIUM_GROUND_ROUTE_OPTIONS,
  GOOGLE_3D_TILES_RENDER_OPTIONS,
} from "@/providers/cesium-render-quality";

describe("Cesium render quality", () => {
  it("refines complete photogrammetry tiles instead of exposing skipped LOD gaps", () => {
    expect(GOOGLE_3D_TILES_RENDER_OPTIONS.skipLevelOfDetail).toBe(false);
    expect(GOOGLE_3D_TILES_RENDER_OPTIONS.maximumScreenSpaceError).toBeLessThanOrEqual(16);
  });

  it("keeps the route on the ground without a through-terrain duplicate", () => {
    expect(CESIUM_GROUND_ROUTE_OPTIONS).toEqual({
      clampToGround: true,
      zIndex: 10,
    });
    expect(CESIUM_GROUND_ROUTE_OPTIONS).not.toHaveProperty("depthFailMaterial");
  });
});
