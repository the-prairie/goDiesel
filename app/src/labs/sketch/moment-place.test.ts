import { describe, expect, it } from "vitest";

import { footprintAt, streetFronts, tappedFootprint } from "@/labs/sketch/moment-place";

// Small offsets near Kyoto: 1e-4° of latitude is about 11.1 m.
const LNG = 135.77;
const LAT = 35.0;
const M_LAT = 1 / 111_320;
const M_LNG = 1 / (111_320 * Math.cos((LAT * Math.PI) / 180));
const at = (east: number, north: number): [number, number] => [LNG + east * M_LNG, LAT + north * M_LAT];
const square = (east: number, north: number, size: number): [number, number][] => [at(east, north), at(east + size, north), at(east + size, north + size), at(east, north + size), at(east, north)];

describe("footprintAt", () => {
  it("finds the one footprint under her finger among a tile's merged buildings", () => {
    const merged = [[square(0, 0, 10)], [square(30, 0, 10)]];
    expect(footprintAt({ type: "MultiPolygon", coordinates: merged }, at(35, 5))).toEqual(square(30, 0, 10));
    expect(footprintAt({ type: "Polygon", coordinates: [square(0, 0, 10)] }, at(5, 5))).toEqual(square(0, 0, 10));
    expect(footprintAt({ type: "MultiPolygon", coordinates: merged }, at(20, 5))).toBeNull();
  });
});

describe("streetFronts", () => {
  it("puts the front on the edge nearest the street, facing it, at its middle", () => {
    // A street running east-west 6 m south of the building.
    const road = [at(-50, -6), at(60, -6)];
    const [front] = streetFronts(square(0, 0, 10), [road]);
    expect(front.facingDeg).toBeCloseTo(180, 0);
    expect(front.frontM).toBeCloseTo(10, 1);
    expect(front.at.lng).toBeCloseTo(at(5, 0)[0], 7);
    expect(front.at.lat).toBeCloseTo(at(5, 0)[1], 7);
  });

  it("faces a street to the east, east", () => {
    const road = [at(16, -40), at(16, 40)];
    expect(streetFronts(square(0, 0, 10), [road])[0].facingDeg).toBeCloseTo(90, 0);
  });

  it("offers every other side to turn to, nearest the street first, and works the same with the ring wound either way", () => {
    const road = [at(-50, -6), at(60, -6)];
    const fronts = streetFronts(square(0, 0, 10), [road]);
    expect(fronts.map((f) => Math.round(f.facingDeg))).toEqual([180, 90, 270, 0].filter((d) => fronts.some((f) => Math.round(f.facingDeg) === d)).sort((a, b) => (a === 180 ? -1 : b === 180 ? 1 : 0)));
    expect(fronts).toHaveLength(4);
    const reversed = streetFronts([...square(0, 0, 10)].reverse(), [road]);
    expect(reversed[0].facingDeg).toBeCloseTo(180, 0);
  });

  it("faces the longest side when no street is near", () => {
    const long: [number, number][] = [at(0, 0), at(20, 0), at(20, 8), at(0, 8), at(0, 0)];
    const [front] = streetFronts(long, []);
    expect(front.frontM).toBeCloseTo(20, 1);
  });
});

describe("the building she tapped, seen at a steep angle", () => {
  // Two houses side by side; the ground point under her finger lies behind the nearer one.
  const near: [number, number][] = [[135, 35], [135.0002, 35], [135.0002, 35.0002], [135, 35.0002], [135, 35]];
  const far: [number, number][] = [[135.001, 35], [135.0012, 35], [135.0012, 35.0002], [135.001, 35.0002], [135.001, 35]];
  const geometry = { type: "MultiPolygon", coordinates: [[near], [far]] } as const;

  it("is the footprint under her finger when the ground point is inside one", () => {
    expect(tappedFootprint(geometry as never, [135.0001, 35.0001])).toEqual(near);
  });

  it("is the nearest footprint of the building drawn there when the ground point falls behind it", () => {
    expect(tappedFootprint(geometry as never, [135.0001, 35.0006])).toEqual(near);
    expect(tappedFootprint({ type: "LineString", coordinates: [] } as never, [135, 35])).toBeNull();
  });
});
