// Her cities where Google has Photorealistic 3D Tiles, kept with the route
// data so the sketch knows where it may hand over to the real-geometry
// sketch without fetching anything to find out. Authored by hand: add a
// city only after seeing Google's 3D there.
//
// `groundEllipsoidM` is the city's typical street height above the WGS84
// ellipsoid (sea level plus the geoid there), which Google's tiles use and
// MapLibre's flat map does not: it lets the two cameras stand at the same
// height over the street.

export interface PhotorealCity {
  city: string;
  west: number;
  south: number;
  east: number;
  north: number;
  groundEllipsoidM: number;
}

export const PHOTOREAL_COVERAGE: readonly PhotorealCity[] = [
  // Kyoto basin. Streets about 20-60 m above sea level; geoid about +37 m.
  { city: "Kyoto, Japan", west: 135.62, south: 34.88, east: 135.86, north: 35.1, groundEllipsoidM: 70 },
];

export function coverageAt(lng: number, lat: number): PhotorealCity | null {
  return PHOTOREAL_COVERAGE.find((city) => lng >= city.west && lng <= city.east && lat >= city.south && lat <= city.north) ?? null;
}
