import { describe, expect, it } from "vitest";

import { routes } from "@/data/routes";
import { OWNER_PLACES, groupPlaces, placeFor, placeOf } from "@/labs/sketch/sketch-places";

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
