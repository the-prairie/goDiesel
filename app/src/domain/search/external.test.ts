import { describe, it, expect, vi, afterEach } from "vitest";
import { parseExternalRoutes } from "./external";
import { discoveryResponse } from "../../../server/discovery";
const way = (ref: number, lat: number) => ({
  type: "way",
  ref,
  geometry: [
    { lat, lon: 0 },
    { lat: lat + 0.01, lon: 0.01 },
  ],
});
const route = (
  members: NonNullable<
    NonNullable<
      Parameters<typeof parseExternalRoutes>[0]["elements"]
    >[number]["members"]
  >,
  tags = {},
) => ({
  elements: [
    {
      type: "relation",
      id: 123,
      tags: { name: "Sample trail", type: "route", route: "hiking", ...tags },
      members,
    },
  ],
});
describe("external route evidence", () => {
  it("preserves disconnected member geometry without joining the gap", () => {
    const result = parseExternalRoutes(route([way(1, 50), way(2, 51)]));
    expect(result[0].lines).toHaveLength(2);
    expect(result[0].distanceKm).toBeLessThan(5);
    expect(result[0].ascentM).toBeUndefined();
    expect(result[0].distanceKind).toBe("mapped");
  });
  it("rejects incomplete and nested relation geometry", () => {
    expect(
      parseExternalRoutes(route([way(1, 50), { type: "way", ref: 2 }])),
    ).toEqual([]);
    expect(
      parseExternalRoutes(route([way(1, 50), { type: "relation", ref: 2 }])),
    ).toEqual([]);
  });
  it("deduplicates repeated ways and distinguishes source metrics", () => {
    const r = parseExternalRoutes(
      route([way(1, 50), way(1, 50)], { distance: "5 mi", ascent: "500 m" }),
    )[0];
    expect(r.lines).toHaveLength(1);
    expect(r.distanceKm).toBeCloseTo(8.04672);
    expect(r.distanceKind).toBe("source");
    expect(r.ascentM).toBe(500);
  });
  it("rejects invalid coordinates", () => {
    expect(parseExternalRoutes(route([way(1, 99)]))).toEqual([]);
  });
});
afterEach(() => vi.unstubAllGlobals());
describe("discovery API bounds", () => {
  it("rejects missing/invalid coordinates before making any request", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    for (const query of ["", "?lat=99&lng=0", "?lat=0&lng=NaN", "?place="])
      expect(
        (
          await discoveryResponse(
            new Request(`http://localhost/api/discovery${query}`),
          )
        ).status,
      ).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("fails visibly on upstream errors instead of returning invented matches", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(Error("offline")));
    const r = await discoveryResponse(
      new Request("http://localhost/api/discovery?lat=45&lng=2"),
    );
    expect(r.status).toBe(503);
    expect(await r.json()).toHaveProperty("error");
  });
});
it("uses way tags for surfaces without presenting partial coverage as complete", () => {
  const data = route([way(1, 50), way(2, 51)]);
  const extra = [{ type: "way", id: 1, tags: { surface: "gravel" } }];
  const r = parseExternalRoutes({ elements: [...data.elements, ...extra] })[0];
  expect(r.surface).toBeUndefined();
  expect(r.surfaces).toEqual(["gravel"]);
  expect(r.surfaceCoverage).toBeGreaterThan(0.4);
  expect(r.surfaceCoverage).toBeLessThan(0.6);
  const complete = parseExternalRoutes({
    elements: [
      ...data.elements,
      ...extra,
      { type: "way", id: 2, tags: { surface: "gravel" } },
    ],
  })[0];
  expect(complete).toMatchObject({
    surface: "gravel",
    surfaceEvidence: "all-ways",
    surfaceCoverage: 1,
  });
});
