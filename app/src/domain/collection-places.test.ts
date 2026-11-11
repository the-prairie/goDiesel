import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { routes } from "@/data/routes";
import { searchCollection } from "@/data/discovery-provider";
import { collectionPlaces } from "./collection-places";
import { interpretQuery } from "./search/intent";
import type { FinderIntent } from "./planning";

const documents = JSON.parse(readFileSync("public/search/collection.json", "utf8")).documents;
const browse = (place: string): FinderIntent => ({ place, activity: "Any", distanceKm: 0, terrain: "any", vibe: "", explicitFilters: ["place", "activity"] });

describe("collection place browsing", () => {
  it("derives every place and count from the collection without mutating it", () => {
    const input = [
      { ...routes[0], region: "New place" },
      { ...routes[1], region: "New place" },
      { ...routes[2], region: "Another place" },
      { ...routes[3], region: "Planned only", lifecycle: "planned" as const },
    ];
    const original = structuredClone(input);
    expect(collectionPlaces(input).map(p => [p.name, p.routes.length])).toEqual([["Another place", 1], ["New place", 2]]);
    expect(input).toEqual(original);
    expect(collectionPlaces([])).toEqual([]);
  });

  it("returns exactly the routes counted for every place, with or without the search index", () => {
    const places = collectionPlaces(routes);
    expect(places.reduce((n, p) => n + p.routes.length, 0)).toBe(routes.filter(r => r.lifecycle !== "planned").length);
    for (const place of places) {
      for (const docs of [documents, []]) {
        const intent = interpretQuery("", browse(place.name), places.map(p => p.name));
        const result = searchCollection(intent, docs);
        expect(result.candidates.map(c => c.sourceRouteSlug).sort(), place.name).toEqual(place.routes.map(r => r.slug).sort());
      }
    }
  });

  it("includes mixed activities and all distances, then allows an explicit activity filter", () => {
    const intent = browse("Victoria, BC");
    expect(searchCollection(intent).candidates).toHaveLength(4);
    expect(new Set(searchCollection(intent).candidates.map(c => c.route.type))).toEqual(new Set(["Run", "Ride"]));
    expect(searchCollection({ ...intent, activity: "Ride" }).candidates).toHaveLength(1);
  });
});
