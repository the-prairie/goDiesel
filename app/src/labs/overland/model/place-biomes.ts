// How each of her places looks in the pixel world: its biome (the ground,
// trees and water drawn around her line) and whether it is on the coast.
// The table carries the looks chosen in the approved prototype. A place it
// has never seen gets a default from its latitude, so new route data never
// fails; add it here to choose its look.

export const BIOMES = [
  "pnw",
  "alpine",
  "swamp",
  "prairie",
  "calif",
  "city",
  "med",
  "volc",
  "jungle",
  "japan",
  "farm",
] as const;

export type Biome = (typeof BIOMES)[number];

export interface PlaceLook {
  biome: Biome;
  coastal: boolean;
  /** False when the look is the latitude default rather than chosen. */
  explicit: boolean;
}

const PLACES: Record<string, [Biome, boolean]> = {
  "Crete, Greece": ["med", true],
  "Canary Islands": ["volc", true],
  "Bali, Indonesia": ["jungle", true],
  "Banff/Kananaskis": ["alpine", false],
  "Nanaimo, BC": ["pnw", true],
  "Victoria, BC": ["pnw", true],
  "Tokyo, Japan": ["city", false],
  "Bay Area, CA": ["calif", true],
  "Mainland Greece": ["med", false],
  "Bologna, Italy": ["city", false],
  "Kyoto, Japan": ["japan", false],
  Japan: ["japan", false],
  "Hiroshima, Japan": ["japan", true],
  "Rome, Italy": ["city", false],
  "Costa Brava, Spain": ["med", true],
  "Okayama, Japan": ["japan", false],
  "Bragg Creek, AB": ["swamp", false],
  "Calgary, AB": ["prairie", false],
  "London, UK": ["city", false],
  "Saskatoon, SK": ["prairie", false],
  "Los Angeles, CA": ["calif", true],
  "Highwood Pass": ["alpine", false],
  "New York, NY": ["city", false],
  "Veneto, Italy": ["farm", false],
  "Verona, Italy": ["farm", false],
  "Treviso, Italy": ["farm", false],
  "Madrid, Spain": ["city", false],
  "Ucluelet, BC": ["pnw", true],
  "Vancouver, BC": ["pnw", true],
};

function latitudeDefault(lat: number): Biome {
  const distance = Math.abs(lat);
  if (distance < 23.5) return "jungle";
  if (distance < 40) return "med";
  return "farm";
}

export function placeLook(place: string, lat: number): PlaceLook {
  const chosen = PLACES[place];
  if (chosen) return { biome: chosen[0], coastal: chosen[1], explicit: true };
  return { biome: latitudeDefault(lat), coastal: false, explicit: false };
}
