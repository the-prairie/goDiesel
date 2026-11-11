import { describe, expect, it } from "vitest";

import {
  chapterOrder,
  memoryYears,
  placesInYear,
  routeYear,
  yearFromPointer,
} from "@/surfaces/atlas/atlas-memory";
import type { RouteRegion } from "@/data/route-regions";
import type { RouteSummary } from "@/domain/route";

function route(date: string, region: string, kilometres = 10): RouteSummary {
  return {
    slug: `${region}-${date}`,
    activityId: date,
    lifecycle: "completed",
    name: region,
    subtitle: "",
    activityName: region,
    region,
    date,
    distanceKm: kilometres,
    elevationGainM: 100,
    type: "Run",
    description: "",
    completionRule: "",
    effortTier: "Steady",
    theme: "",
    xp: 0,
    trace: [],
    centerLat: 0,
    centerLng: 0,
    replay: {
      replayMode: "atlas",
      replayEligible: true,
      bestInEarth: false,
      geometryStatus: "ready",
    },
    guide: { reviewStatus: "draft" },
  };
}

describe("atlas memory", () => {
  const routes = [
    route("2024-12-27", "Crete, Greece", 30),
    route("2024-01-02", "Crete, Greece", 15),
    route("2025-11-26", "Tokyo, Japan", 21),
    route("2021-06-01", "Victoria, BC", 12),
  ];

  it("reads a recorded year and ignores a blank date", () => {
    expect(routeYear("2024-12-27")).toBe(2024);
    expect(routeYear("")).toBeNull();
  });

  it("lists years in order and groups that year's places by how many routes they hold", () => {
    expect(memoryYears(routes)).toEqual([2021, 2024, 2025]);
    expect(placesInYear(routes, 2024)).toEqual([
      { name: "Crete, Greece", count: 2, kilometres: 45 },
    ]);
  });

  it("orders chapters by the latest recorded day", () => {
    const regions = [
      { name: "Crete, Greece", routes: [route("2024-12-27", "Crete, Greece")] },
      { name: "Tokyo, Japan", routes: [route("2025-11-26", "Tokyo, Japan")] },
    ] as RouteRegion[];
    expect(chapterOrder(regions).map((region) => region.name)).toEqual([
      "Tokyo, Japan",
      "Crete, Greece",
    ]);
  });

  it("maps a drag along the rail to a year", () => {
    const years = [2021, 2022, 2023, 2024, 2025];
    expect(yearFromPointer(0, 0, 100, years)).toBe(2021);
    expect(yearFromPointer(100, 0, 100, years)).toBe(2025);
    expect(yearFromPointer(50, 0, 100, years)).toBe(2023);
  });
});
