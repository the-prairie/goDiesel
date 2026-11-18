// Which building tradition a place draws from, by longitude and latitude.
// Broad boxes, checked in order; anywhere else is "other", a neutral city.

export type RegionId = "japan" | "mediterranean" | "aegean" | "northern-europe" | "north-america" | "tropical" | "other";

/** In the order the facade shader numbers them. */
export const REGIONS: readonly RegionId[] = ["other", "japan", "mediterranean", "aegean", "northern-europe", "north-america", "tropical"];

const BOXES: [RegionId, number, number, number, number][] = [
  // [region, west, east, south, north]
  ["japan", 122, 154, 24, 46],
  ["aegean", 19, 30, 34, 42],
  ["aegean", -19, -13, 27, 30],
  ["mediterranean", -10, 36, 30, 46.5],
  ["northern-europe", -11, 40, 46.5, 72],
  ["north-america", -170, -50, 15, 72],
  ["tropical", 90, 160, -12, 23],
];

export function regionAt(lng: number, lat: number): RegionId {
  for (const [region, west, east, south, north] of BOXES) if (lng >= west && lng <= east && lat >= south && lat <= north) return region;
  return "other";
}
