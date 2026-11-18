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

export interface PlaceDecision {
  place: string;
  country: string;
}

/**
 * The owner's decisions on where a route belongs, by route id: its place and
 * country in place of what its generated region says. Exact and explicit,
 * never inferred. A place may be one the data does not have yet; a place left
 * with no routes is gone. Each belongs at the source (the route's region in
 * quests.json, then a rebuild); once that is done, delete its entry here (the
 * test fails while a route's own data already says the same).
 */
export const OWNER_PLACES: Readonly<Record<string, PlaceDecision>> = {
  // 2026-11-14, the owner: "Yes, the Japan ones, one is Kyoto and one Tokyo."
  // Named only "Japan" in its data; it was run in Kyoto (35.03, 135.78).
  "17626995684": { place: "Kyoto", country: "Japan" },
  // Same decision; run in Tokyo (35.68, 139.73).
  "17586941421": { place: "Tokyo", country: "Japan" },

  // 2026-11-14, the owner, all confirmed: Bali, Crete, Mainland Greece and
  // the Canary Islands are split into the places she ran (each was "one
  // place" in the data though up to 172 km across).
  // Bali, Indonesia ("the 2 bali runs are sideman": spelt Sidemen).
  "9945324433": { place: "Uluwatu", country: "Indonesia" },
  "9953403673": { place: "Canggu", country: "Indonesia" },
  "9959792315": { place: "Canggu", country: "Indonesia" },
  "10075093128": { place: "Sidemen", country: "Indonesia" },
  "10082410891": { place: "Sidemen", country: "Indonesia" },
  // Crete, Greece ("This was chania"; Argyroupoli: "Yes it was").
  "13134774070": { place: "Chania", country: "Greece" },
  "14080158961": { place: "Chania", country: "Greece" },
  "14030669837": { place: "Chania", country: "Greece" },
  "14023448720": { place: "Balos", country: "Greece" },
  "14064880083": { place: "Paleochora", country: "Greece" },
  "14130768855": { place: "Argyroupoli", country: "Greece" },
  "14130772463": { place: "Sfakia", country: "Greece" },
  "14130782031": { place: "Sfakia", country: "Greece" },
  // Mainland Greece (one was on an island, so "Mainland" goes).
  "13935098460": { place: "Athens", country: "Greece" },
  "13941094274": { place: "Hydra", country: "Greece" },
  "13971753429": { place: "Delphi", country: "Greece" },
  // Canary Islands, Spain: one place per island.
  "14160295943": { place: "Gran Canaria", country: "Spain" },
  "14262327221": { place: "Gran Canaria", country: "Spain" },
  "14349820520": { place: "Fuerteventura", country: "Spain" },
  "14394581660": { place: "Fuerteventura", country: "Spain" },
  "14415835303": { place: "Fuerteventura", country: "Spain" },
  "14422331296": { place: "Fuerteventura", country: "Spain" },
  // Labelled only "Veneto, Italy": "It was valdobbiadene" (Treviso and Verona stay their own places).
  "8790922344": { place: "Valdobbiadene", country: "Italy" },
};

/**
 * Routes the owner keeps out of the atlas, with why. Fix at the source later
 * (the route's lifecycle in quests.json, then a rebuild), then delete here.
 */
export const OWNER_HIDDEN: Readonly<Record<string, string>> = {
  // 2026-11-14, the owner ("Yes"): Rome's 18.3 km Strava recording stopped
  // partway; her full run is the 28.5 km import below. Hidden so it is listed once.
  "8836227189": "the partial recording of her Rome run",
};

/**
 * Routes the generated data does not mark completed that the owner counts as
 * her own runs. Fix at the source later, then delete here.
 */
export const OWNER_RUNS: Readonly<Record<string, string>> = {
  // 2026-11-14, the owner ("Yes"): she ran it; the full 28.5 km route,
  // re-imported as GPX (no timing). Generated as "discovered".
  "3519505225411091950": "her full Rome run, re-imported",
};

/** Her routes as the atlas shows them: none she hid, and those she counts as hers marked completed. */
export function atlasRoutes<T extends { slug: string; lifecycle: string }>(routes: readonly T[]): T[] {
  return routes
    .filter((route) => !OWNER_HIDDEN[route.slug])
    .map((route) => (OWNER_RUNS[route.slug] && route.lifecycle !== "completed" ? { ...route, lifecycle: "completed" } : route));
}

/** A route's place and country, with the owner's decision where she has made one. */
export function placeFor(slug: string, region: string, decisions: Readonly<Record<string, PlaceDecision>> = OWNER_PLACES) {
  return decisions[slug] ?? placeOf(region);
}

/** A route's entry carrying the place name the atlas shows, for anything that prints it. */
export function withOwnerPlace<T extends { slug: string; place: string }>(entry: T, decisions: Readonly<Record<string, PlaceDecision>> = OWNER_PLACES): T {
  return { ...entry, place: placeFor(entry.slug, entry.place, decisions).place };
}

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
export function groupPlaces(routes: readonly { slug: string; region: string }[], decisions: Readonly<Record<string, PlaceDecision>> = OWNER_PLACES): CountryGroup[] {
  const countries = new Map<string, Map<string, string[]>>();
  for (const { slug, region } of routes) {
    const { place, country } = placeFor(slug, region, decisions);
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
