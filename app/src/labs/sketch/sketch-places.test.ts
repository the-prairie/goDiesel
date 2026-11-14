import { describe, expect, it } from "vitest";

import { routes } from "@/data/routes";
import { buildOverlandEntries } from "@/labs/overland/model/overland-entries";
import { OWNER_HIDDEN, OWNER_PLACES, OWNER_RUNS, atlasRoutes, groupPlaces, placeFor, placeOf } from "@/labs/sketch/sketch-places";

describe("her places and countries, from the routes' own region names", () => {
  it("reads 'Place, Country' and 'Place, State or Province' by exact tables, never by guessing", () => {
    expect(placeOf("Kyoto, Japan")).toEqual({ place: "Kyoto", country: "Japan" });
    expect(placeOf("Victoria, BC")).toEqual({ place: "Victoria", country: "Canada" });
    expect(placeOf("Bay Area, CA")).toEqual({ place: "Bay Area", country: "United States" });
    expect(placeOf("London, UK")).toEqual({ place: "London", country: "United Kingdom" });
  });

  it("names the country of a region that has none, from its own table", () => {
    expect(placeOf("Banff/Kananaskis")).toEqual({ place: "Banff and Kananaskis", country: "Canada" });
    expect(placeOf("Canary Islands")).toEqual({ place: "Canary Islands", country: "Spain" });
    expect(placeOf("Mainland Greece")).toEqual({ place: "Mainland Greece", country: "Greece" });
  });

  it("leaves a region it does not know unplaced rather than guessing", () => {
    expect(placeOf("Atlantis")).toEqual({ place: "Atlantis", country: null });
  });

  it("places every one of her routes", () => {
    const unplaced = routes.filter((route) => placeOf(route.region).country === null).map((route) => route.region);
    expect(unplaced).toEqual([]);
  });

  it("groups routes into countries and places, each with its routes", () => {
    const countries = groupPlaces([
      { slug: "a", region: "Kyoto, Japan" },
      { slug: "b", region: "Tokyo, Japan" },
      { slug: "c", region: "Kyoto, Japan" },
      { slug: "d", region: "Victoria, BC" },
    ]);
    expect(countries.map((c) => c.country)).toEqual(["Canada", "Japan"]);
    const japan = countries.find((c) => c.country === "Japan")!;
    expect(japan.places.map((p) => [p.place, p.slugs])).toEqual([
      ["Kyoto", ["a", "c"]],
      ["Tokyo", ["b"]],
    ]);
  });
});

describe("the owner's decisions on where a route belongs", () => {
  const completed = routes.filter((route) => route.lifecycle === "completed");
  const groups = groupPlaces(completed.map((route) => ({ slug: route.slug, region: route.region })));
  const placeOfSlug = (slug: string) => groups.flatMap((country) => country.places.map((place) => ({ ...place, country: country.country }))).find((place) => place.slugs.includes(slug));

  it("puts her two routes named only \"Japan\" in Kyoto and Tokyo, as she said", () => {
    expect(placeOfSlug("17626995684")).toMatchObject({ country: "Japan", place: "Kyoto" });
    expect(placeOfSlug("17586941421")).toMatchObject({ country: "Japan", place: "Tokyo" });
    expect(groups.find((country) => country.country === "Japan")?.places.map((place) => place.place)).not.toContain("Japan, place not named");
  });

  it("still counts every one of her routes exactly once", () => {
    const counted = groups.flatMap((country) => country.places.flatMap((place) => place.slugs));
    expect(counted).toHaveLength(completed.length);
    expect(new Set(counted).size).toBe(completed.length);
  });

  it("holds no decision the route's own data already says (fix it at the source, then delete it here)", () => {
    for (const [slug, decided] of Object.entries(OWNER_PLACES)) {
      const route = routes.find((candidate) => candidate.slug === slug);
      expect(route, `owner decision for ${slug} names no route`).toBeDefined();
      expect(placeOf(route!.region), `route ${slug} already says ${decided.place}, ${decided.country}: delete its owner decision in sketch-places.ts`).not.toEqual(decided);
    }
  });

  it("reads a route's place through her decisions", () => {
    expect(placeFor("17626995684", "Japan")).toEqual({ place: "Kyoto", country: "Japan" });
    expect(placeFor("someone-else", "Rome, Italy")).toEqual({ place: "Rome", country: "Italy" });
  });

  it("can name a place the data does not have yet, and drops a place left with no routes", () => {
    const decisions = { a: { place: "Lanzarote", country: "Spain" }, b: { place: "Lanzarote", country: "Spain" } };
    const grouped = groupPlaces([{ slug: "a", region: "Canary Islands" }, { slug: "b", region: "Canary Islands" }, { slug: "c", region: "Madrid, Spain" }], decisions);
    expect(grouped).toEqual([{ country: "Spain", places: [{ place: "Lanzarote", slugs: ["a", "b"] }, { place: "Madrid", slugs: ["c"] }] }]);
  });
});

describe("the owner's decisions of 2026-11-14: splitting wide places, Valdobbiadene, and Rome's full run", () => {
  const shown = atlasRoutes(routes);
  const groups = groupPlaces(shown.map((route) => ({ slug: route.slug, region: route.region })));
  const places = groups.flatMap((country) => country.places.map((place) => ({ ...place, country: country.country })));
  const where = (slug: string) => places.find((place) => place.slugs.includes(slug));
  const names = (country: string) => groups.find((group) => group.country === country)!.places.map((place) => place.place);

  it("moves only routes that were where she said they were (a mistyped id cannot slip in)", () => {
    const from: Record<string, string> = { Uluwatu: "Bali, Indonesia", Canggu: "Bali, Indonesia", Sidemen: "Bali, Indonesia", Chania: "Crete, Greece", Balos: "Crete, Greece", Paleochora: "Crete, Greece", Argyroupoli: "Crete, Greece", Sfakia: "Crete, Greece", Athens: "Mainland Greece", Hydra: "Mainland Greece", Delphi: "Mainland Greece", "Gran Canaria": "Canary Islands", Fuerteventura: "Canary Islands", Valdobbiadene: "Veneto, Italy", Kyoto: "Japan", Tokyo: "Japan" };
    for (const [slug, decided] of Object.entries(OWNER_PLACES)) expect(routes.find((route) => route.slug === slug)?.region, `${slug} → ${decided.place}`).toBe(from[decided.place]);
  });

  it("splits Bali, Crete, Mainland Greece and the Canary Islands into her places, and the wide ones are gone", () => {
    expect(names("Indonesia")).toEqual(["Canggu", "Sidemen", "Uluwatu"]);
    expect(names("Greece")).toEqual(["Argyroupoli", "Athens", "Balos", "Chania", "Delphi", "Hydra", "Paleochora", "Sfakia"]);
    expect(names("Spain")).toEqual(expect.arrayContaining(["Fuerteventura", "Gran Canaria"]));
    for (const gone of ["Bali", "Crete", "Mainland Greece", "Canary Islands", "Veneto"]) expect(places.map((place) => place.place)).not.toContain(gone);
    expect(where("13134774070")?.slugs).toHaveLength(3);
    expect(where("14160295943")?.slugs).toHaveLength(2);
    expect(where("14349820520")?.slugs).toHaveLength(4);
  });

  it("puts her Veneto route in Valdobbiadene, beside Treviso and Verona", () => {
    expect(where("8790922344")).toMatchObject({ country: "Italy", place: "Valdobbiadene" });
    expect(names("Italy")).toEqual(expect.arrayContaining(["Treviso", "Verona", "Valdobbiadene"]));
  });

  it("shows Rome's full 28.5 km run as hers and hides the 18.3 km partial, so the run is listed once", () => {
    expect(shown.map((route) => route.slug)).toContain("3519505225411091950");
    expect(shown.map((route) => route.slug)).not.toContain("8836227189");
    expect(shown.find((route) => route.slug === "3519505225411091950")?.lifecycle).toBe("completed");
    expect(where("3519505225411091950")).toMatchObject({ country: "Italy", place: "Rome", slugs: ["3519505225411091950"] });
  });

  it("keeps every route number but Rome's, and Rome's full run takes the partial's 20 by date", () => {
    const before = new Map(buildOverlandEntries(routes).map((entry) => [entry.slug, entry.number]));
    const after = buildOverlandEntries(shown);
    for (const entry of after) if (entry.slug !== "3519505225411091950") expect(entry.number, entry.slug).toBe(before.get(entry.slug));
    expect(after.find((entry) => entry.slug === "3519505225411091950")?.number).toBe(before.get("8836227189"));
  });

  it("counts her routes once each: 66 routes, 8 countries, 37 places", () => {
    const counted = places.flatMap((place) => place.slugs);
    expect(counted).toHaveLength(shown.length);
    expect(new Set(counted).size).toBe(66);
    expect(groups).toHaveLength(8);
    expect(places).toHaveLength(37);
  });

  it("holds no hide or count-as-hers decision the data already makes (fix at the source, then delete)", () => {
    for (const slug of Object.keys(OWNER_HIDDEN)) expect(routes.find((route) => route.slug === slug), `hidden ${slug} names no route: delete it`).toBeDefined();
    for (const slug of Object.keys(OWNER_RUNS)) expect(routes.find((route) => route.slug === slug)?.lifecycle, `${slug} is already completed: delete its OWNER_RUNS entry`).not.toBe("completed");
  });
});
