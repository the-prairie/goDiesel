import { describe, expect, it } from "vitest";

import {
  elevationProfileGeometry,
  ROUTE_CAROUSEL_SLIDE_CLASS,
  routeTracePolyline,
} from "@/components/globe/region-route-carousel";
import type { RoutePoint } from "@/domain/routes";

const trace: RoutePoint[] = [
  { lat: 35.1, lng: 179.8, elev: 120, d: 0 },
  { lat: 35.2, lng: -179.9, elev: 360, d: 5_000 },
  { lat: 35.15, lng: -179.7, elev: 180, d: 10_000 },
];

describe("region route carousel geometry", () => {
  it("creates the same antimeridian-safe route trace for the same recorded points", () => {
    const first = routeTracePolyline(trace);

    expect(first).toBe(routeTracePolyline(trace));
    expect(first?.split(" ")).toHaveLength(3);
    expect(first).not.toContain("NaN");
  });

  it("derives an elevation profile and recorded range without inventing data", () => {
    const profile = elevationProfileGeometry(trace);

    expect(profile).toMatchObject({ minimum: 120, maximum: 360 });
    expect(profile?.points.split(" ")).toHaveLength(3);
    expect(profile?.area).toMatch(/^M 0 62 L /);
  });

  it("returns unavailable geometry when fewer than two usable points exist", () => {
    expect(routeTracePolyline([])).toBeNull();
    expect(elevationProfileGeometry([{ ...trace[0], lat: Number.NaN }])).toBeNull();
  });

  it("reserves one card plus a mobile peek, two-plus on tablet, and three on desktop", () => {
    expect(ROUTE_CAROUSEL_SLIDE_CLASS).toContain("flex-[0_0_84%]");
    expect(ROUTE_CAROUSEL_SLIDE_CLASS).toContain("sm:basis-[44%]");
    expect(ROUTE_CAROUSEL_SLIDE_CLASS).toContain(
      "xl:basis-[calc((100%-2rem)/3)]",
    );
  });
});
