import { describe, expect, it } from "vitest";

import { regionAt } from "@/labs/sketch/sketch-region";

describe("regionAt", () => {
  it.each([
    ["Kyoto", 135.77, 35.0, "japan"],
    ["Tokyo", 139.69, 35.68, "japan"],
    ["Hiroshima", 132.46, 34.39, "japan"],
    ["Rome", 12.47, 41.89, "mediterranean"],
    ["Bologna", 11.34, 44.49, "mediterranean"],
    ["Treviso", 12.24, 45.67, "mediterranean"],
    ["Madrid", -3.7, 40.4, "mediterranean"],
    ["Costa Brava", 3.0, 41.9, "mediterranean"],
    ["Crete", 25.1, 35.3, "aegean"],
    ["Athens", 23.73, 37.98, "aegean"],
    ["Canary Islands", -15.4, 28.1, "aegean"],
    ["London", -0.15, 51.5, "northern-europe"],
    ["Calgary", -114.07, 51.04, "north-america"],
    ["Nanaimo", -123.97, 49.17, "north-america"],
    ["Saskatoon", -106.6, 52.1, "north-america"],
    ["New York", -73.98, 40.67, "north-america"],
    ["Los Angeles", -118.24, 34.05, "north-america"],
    ["Bali", 115.2, -8.6, "tropical"],
    ["Sydney", 151.2, -33.9, "other"],
    ["Nairobi", 36.8, -1.3, "other"],
  ])("puts %s in %s", (_name, lng, lat, region) => {
    expect(regionAt(lng, lat)).toBe(region);
  });
});
