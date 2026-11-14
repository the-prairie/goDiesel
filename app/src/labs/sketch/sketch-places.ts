// Her places and countries, read from each route's own region name by exact
// tables: "Place, Country" or "Place, State/Province", and a few regions that
// name no country. Nothing is matched loosely; a region these tables do not
// know stays unplaced (country null) so it shows up, rather than being guessed.

/** The last part of "Place, Suffix" to its country. */
const SUFFIX: Record<string, string> = {
  Japan: "Japan",
  Indonesia: "Indonesia",
  Italy: "Italy",
  Spain: "Spain",
  Greece: "Greece",
  UK: "United Kingdom",
  CA: "United States",
  NY: "United States",
  AB: "Canada",
  BC: "Canada",
  SK: "Canada",
};

/** Regions that name no country, whole. */
const WHOLE: Record<string, { place: string; country: string }> = {
  "Banff/Kananaskis": { place: "Banff and Kananaskis", country: "Canada" },
  "Highwood Pass": { place: "Highwood Pass", country: "Canada" },
  "Canary Islands": { place: "Canary Islands", country: "Spain" },
  "Mainland Greece": { place: "Mainland Greece", country: "Greece" },
  // Two routes name only the country: they are kept together as their own place.
  Japan: { place: "Japan, place not named", country: "Japan" },
};

export function placeOf(region: string): { place: string; country: string | null } {
  if (WHOLE[region]) return WHOLE[region];
  const comma = region.lastIndexOf(", ");
  if (comma > 0) {
    const country = SUFFIX[region.slice(comma + 2)];
    if (country) return { place: region.slice(0, comma), country };
  }
  return { place: region, country: null };
}

export interface PlaceGroup {
  place: string;
  slugs: string[];
}

export interface CountryGroup {
  country: string;
  places: PlaceGroup[];
}

/** Routes grouped by country and place, both in alphabetical order; routes keep their order. */
export function groupPlaces(routes: readonly { slug: string; region: string }[]): CountryGroup[] {
  const countries = new Map<string, Map<string, string[]>>();
  for (const { slug, region } of routes) {
    const { place, country } = placeOf(region);
    const key = country ?? "Unplaced";
    const places = countries.get(key) ?? new Map<string, string[]>();
    countries.set(key, places);
    places.set(place, [...(places.get(place) ?? []), slug]);
  }
  const byName = (a: string, b: string) => a.localeCompare(b);
  return [...countries.keys()].sort(byName).map((country) => ({
    country,
    places: [...countries.get(country)!.keys()].sort(byName).map((place) => ({ place, slugs: countries.get(country)!.get(place)! })),
  }));
}
