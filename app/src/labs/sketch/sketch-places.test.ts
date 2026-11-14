import { describe, expect, it } from "vitest";

import { routes } from "@/data/routes";
import { groupPlaces, placeOf } from "@/labs/sketch/sketch-places";

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
