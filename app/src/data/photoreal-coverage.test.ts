import { describe, expect, it } from "vitest";

import { routes } from "@/data/routes";
import { PHOTOREAL_COVERAGE, coverageAt } from "@/data/photoreal-coverage";

describe("coverageAt", () => {
  it("finds Kyoto, where Google has photorealistic 3D, under the start of route 064", () => {
    const start = routes.find((route) => route.slug === "17636880071")!.trace[0];
    expect(coverageAt(start.lng, start.lat)?.city).toBe("Kyoto, Japan");
  });

  it("finds nothing over open sea or a city not on the list", () => {
    expect(coverageAt(140, 30)).toBeNull();
    expect(coverageAt(-114.07, 51.05)).toBeNull();
  });

  it("gives each covered city the height of its ground above the ellipsoid, for matching cameras", () => {
    for (const city of PHOTOREAL_COVERAGE) {
      expect(city.groundEllipsoidM).toBeGreaterThan(-100);
      expect(city.groundEllipsoidM).toBeLessThan(3000);
      expect(city.west).toBeLessThan(city.east);
      expect(city.south).toBeLessThan(city.north);
    }
  });
});
