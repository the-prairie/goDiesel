import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  curatedDiscoveryCandidates,
  searchCollection,
} from "@/data/discovery-provider";
import { routes } from "@/data/routes";
import { interpretQuery, distanceBounds } from "./intent";
import type { FinderIntent } from "../planning";
const base: FinderIntent = {
  place: "",
  activity: "Run",
  distanceKm: 20,
  terrain: "any",
  vibe: "",
};
const docs = JSON.parse(
  readFileSync("public/search/collection.json", "utf8"),
).documents;
describe("Finder hybrid search", () => {
  it("treats beach as an experience and keeps the distance target", () => {
    expect(interpretQuery("beach", base, [])).toMatchObject({place: "", query: "beach", distanceKm: 20});
    expect(interpretQuery("beach near Banff", base, ["Banff, AB"]).place).toBe("Banff");
  });
  it("rejects negated beach mentions even with a semantic vector", () => {
    const intent = {...base, query: "beach", distanceKm: 0};
    for (const vector of [undefined, docs[0].vector]) {
      const slugs = searchCollection(intent, docs, vector).candidates.map(c => c.sourceRouteSlug);
      expect(slugs).toContain("9915035779");
      expect(slugs).toContain("9959792315");
      expect(slugs).not.toContain("9945324433");
      expect(slugs).not.toContain("14130768855");
    }
  });
  it("indexes the complete published collection", () => {
    expect(curatedDiscoveryCandidates).toHaveLength(routes.length);
    expect(docs).toHaveLength(routes.length);
  });
  it("interprets explicit constraints without replacing them with a target tolerance", () => {
    const i = interpretQuery(
      "A coastal trail run near Victoria, 10–15 km with less than 500 m climbing",
      base,
      routes.map((r) => r.region),
    );
    expect(i).toMatchObject({
      place: "Victoria",
      activity: "Run",
      terrain: "trail",
      minDistanceKm: 10,
      maxDistanceKm: 15,
      maxElevationM: 500,
    });
    expect(distanceBounds(i)).toEqual([10, 15]);
  });
  it("keeps a climb ceiling separate from a distance target", () => {
    const i = interpretQuery("Run under 500 m climbing around 20 km", base, []);
    expect(i.maxElevationM).toBe(500);
    expect(i.maxDistanceKm).toBeUndefined();
  });
  it("does not match region names inside unrelated words", () => {
    expect(interpretQuery("a promenade run", base, ["Rome"]).place).toBe("");
  });
  it("retrieves a route by landmarks in its full guide", () => {
    const i = interpretQuery(
      "a run past Westminster and Kensington Gardens",
      base,
      routes.map((r) => r.region),
    );
    expect(searchCollection(i, docs).candidates[0].sourceRouteSlug).toBe(
      "14486170630",
    );
  });
  it("never lets embedding similarity bypass hard constraints", () => {
    const i = {
      ...base,
      distanceKm: 0,
      minDistanceKm: 10,
      maxDistanceKm: 15,
      maxElevationM: 500,
    };
    const result = searchCollection(i, docs, docs[0].vector);
    expect(
      result.candidates.every(
        (c) =>
          c.route.distanceKm >= 10 &&
          c.route.distanceKm <= 15 &&
          c.route.elevationGainM <= 500,
      ),
    ).toBe(true);
  });
  it("uses the reference route vector for like-my-route searches, excluding that route", () => {
    const i = interpretQuery(
      "Something like my Kyoto run",
      base,
      routes.map((r) => r.region),
    );
    expect(i.place).toBe("");
    expect(i.similarPlace).toBe("Kyoto");
    expect(searchCollection(i, docs).candidates.length).toBeGreaterThan(0);
  });
  it("does not show unrelated routes for nonsense text", () => {
    expect(
      searchCollection(
        { ...base, query: "zxqzxq nebulousness", distanceKm: 0 },
        docs,
      ).candidates,
    ).toHaveLength(0);
  });
});
