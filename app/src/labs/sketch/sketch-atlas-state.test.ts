import { describe, expect, it } from "vitest";

import { atlasFromRoute, crumbsOf, initialAtlasState, reduceAtlas } from "@/labs/sketch/sketch-atlas-state";

describe("where she is in the sketch atlas: world, country, place, route", () => {
  it("opens on the world when no route is named", () => {
    expect(initialAtlasState()).toEqual({ phase: "world" });
  });

  it("goes down from the world to a country, a place and a route", () => {
    let state = reduceAtlas(initialAtlasState(), { type: "countryChosen", country: "Italy" });
    expect(state).toEqual({ phase: "country", country: "Italy" });
    state = reduceAtlas(state, { type: "placeChosen", country: "Italy", place: "Rome" });
    expect(state).toEqual({ phase: "place", country: "Italy", place: "Rome", route: null });
    state = reduceAtlas(state, { type: "routeChosen", slug: "r1" });
    expect(state).toEqual({ phase: "place", country: "Italy", place: "Rome", route: "r1" });
  });

  it("goes back up to any level it passed through", () => {
    const deep = { phase: "place", country: "Italy", place: "Rome", route: "r1" } as const;
    expect(reduceAtlas(deep, { type: "up", to: "place" })).toEqual({ phase: "place", country: "Italy", place: "Rome", route: null });
    expect(reduceAtlas(deep, { type: "up", to: "country" })).toEqual({ phase: "country", country: "Italy" });
    expect(reduceAtlas(deep, { type: "up", to: "world" })).toEqual({ phase: "world" });
  });

  it("ignores a route chosen when no place is open, and an up that goes nowhere", () => {
    const world = initialAtlasState();
    expect(reduceAtlas(world, { type: "routeChosen", slug: "r1" })).toBe(world);
    const country = { phase: "country", country: "Italy" } as const;
    expect(reduceAtlas(country, { type: "up", to: "place" })).toBe(country);
  });

  it("opens straight at a named route's place, the route chosen", () => {
    expect(atlasFromRoute({ slug: "r1", country: "Japan", place: "Kyoto" })).toEqual({ phase: "place", country: "Japan", place: "Kyoto", route: "r1" });
  });

  it("names the breadcrumb for wherever she is", () => {
    expect(crumbsOf({ phase: "world" })).toEqual([{ level: "world", label: "World", current: true }]);
    expect(crumbsOf({ phase: "place", country: "Canada", place: "Victoria", route: "r1" })).toEqual([
      { level: "world", label: "World", current: false },
      { level: "country", label: "Canada", current: false },
      { level: "place", label: "Victoria", current: false },
      { level: "street", label: "Street", current: true },
    ]);
  });
});
