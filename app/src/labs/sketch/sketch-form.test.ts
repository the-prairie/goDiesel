import { describe, expect, it } from "vitest";

import { buildingForm, landmarkKind, matchLandmarks, pointInRing, toriiFrom } from "@/labs/sketch/sketch-form";

const house = { areaM2: 90, height: 7, rectangularity: 0.95, region: "japan" as const, landuse: undefined };

describe("buildingForm", () => {
  it("makes a small, low, near-rectangular footprint a house", () => {
    expect(buildingForm(house)).toBe("house");
  });

  it("makes a mid-rise in Japan a mansion block, elsewhere a block; tall ones towers", () => {
    expect(buildingForm({ ...house, areaM2: 600, height: 18 })).toBe("mansion");
    expect(buildingForm({ ...house, areaM2: 600, height: 18, region: "north-america" })).toBe("block");
    expect(buildingForm({ ...house, areaM2: 900, height: 45 })).toBe("tower");
  });

  it("makes a low irregular or large footprint a low block", () => {
    expect(buildingForm({ ...house, rectangularity: 0.6 })).toBe("block");
    expect(buildingForm({ ...house, areaM2: 900 })).toBe("block");
  });

  it("reads the building's type from the land it stands in", () => {
    expect(buildingForm({ ...house, areaM2: 2000, height: 9, landuse: "industrial" })).toBe("shed");
    expect(buildingForm({ ...house, areaM2: 1500, height: 14, landuse: "school" })).toBe("institution");
    expect(buildingForm({ ...house, areaM2: 1500, height: 14, landuse: "hospital" })).toBe("institution");
    expect(buildingForm({ ...house, areaM2: 3000, height: 8, landuse: "retail" })).toBe("retail");
    // A small house on industrial land stays a house; a tower stays a tower.
    expect(buildingForm({ ...house, landuse: "industrial" })).toBe("house");
    expect(buildingForm({ ...house, areaM2: 900, height: 60, landuse: "retail" })).toBe("tower");
  });
});

describe("landmarkKind", () => {
  it("knows temples, shrines and churches, and nothing else", () => {
    expect(landmarkKind("buddhist")).toBe("temple");
    expect(landmarkKind("shinto")).toBe("shrine");
    expect(landmarkKind("christian")).toBe("church");
    expect(landmarkKind("muslim")).toBeNull();
    expect(landmarkKind("undefined")).toBeNull();
  });
});

describe("matchLandmarks", () => {
  const square = (x: number, y: number, s: number): [number, number][] => [[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]];
  const buildings = [{ rings: [square(0, 0, 10)] }, { rings: [square(20, 0, 10)] }];

  it("marks the footprint a place of worship stands in", () => {
    const found = matchLandmarks(buildings, [{ x: 25, y: 5, subclass: "shinto" }]);
    expect([...found]).toEqual([[1, "shrine"]]);
  });

  it("skips a point in no footprint rather than inventing a building, and other faiths' points", () => {
    expect(matchLandmarks(buildings, [{ x: 15, y: 5, subclass: "buddhist" }]).size).toBe(0);
    expect(matchLandmarks(buildings, [{ x: 5, y: 5, subclass: "muslim" }]).size).toBe(0);
  });

  it("is in or out by the ring, not its box", () => {
    const ell: [number, number][] = [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10], [0, 0]];
    expect(pointInRing(2, 8, ell)).toBe(true);
    expect(pointInRing(8, 8, ell)).toBe(false);
  });
});

describe("toriiFrom", () => {
  it("stands a torii at a gate within 40 m of a shrine, crosswise to the way in", () => {
    // 1 unit = 1 m here; the shrine is due 'south' (+y) of the gate.
    const [torii] = toriiFrom([{ x: 0, y: 0 }], [{ x: 0, y: 30 }], 1);
    expect(torii).toMatchObject({ x: 0, y: 0 });
    // The beam runs across the approach: along x.
    expect(Math.abs(Math.cos(torii.angle))).toBeCloseTo(1, 5);
  });

  it("leaves other gates alone", () => {
    expect(toriiFrom([{ x: 0, y: 0 }], [{ x: 0, y: 100 }], 1)).toEqual([]);
  });
});
