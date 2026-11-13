import { describe, expect, it } from "vitest";

import { FACE, MASS_STRIDE, PACKED_BYTES, buildingMass, halfToFloat, inferHeight, orientedBox, packFaces, roofFor } from "@/labs/sketch/sketch-massing";

// Footprints in metres for these tests: one tile unit is one metre.
const rect = (w: number, d: number, x = 0, y = 0): [number, number][] => [
  [x, y],
  [x + w, y],
  [x + w, y + d],
  [x, y + d],
  [x, y],
];
const ell: [number, number][] = [
  [0, 0],
  [30, 0],
  [30, 10],
  [10, 10],
  [10, 30],
  [0, 30],
  [0, 0],
];

const segments = (edges: Float32Array) => {
  const out: number[][] = [];
  for (let i = 0; i < edges.length; i += 6) out.push([...edges.slice(i, i + 6)]);
  return out;
};

describe("inferHeight (invented where the data has none)", () => {
  it("trusts a height the data really gives", () => {
    expect(inferHeight({ dataHeight: 31, areaM2: 400, neighbours: [], seed: 1 })).toBe(31);
  });

  it("gives a small house two storeys, not one flat 6 m", () => {
    const h = inferHeight({ dataHeight: 6, areaM2: 70, neighbours: [], seed: 3 });
    expect(h).toBeGreaterThanOrEqual(6);
    expect(h).toBeLessThanOrEqual(8);
  });

  it("raises a large block with no height to several storeys, and follows tall neighbours", () => {
    const alone = inferHeight({ dataHeight: 6, areaM2: 1200, neighbours: [], seed: 5 });
    expect(alone).toBeGreaterThanOrEqual(14);
    const amongTowers = inferHeight({ dataHeight: 6, areaM2: 500, neighbours: [30, 34, 28, 31], seed: 5 });
    expect(amongTowers).toBeGreaterThan(inferHeight({ dataHeight: 6, areaM2: 500, neighbours: [], seed: 5 }));
  });

  it("never comes out lower than the data, so MapLibre's own box stays hidden inside", () => {
    for (const area of [20, 80, 300, 900, 3000]) for (const seed of [1, 2, 3, 4]) expect(inferHeight({ dataHeight: 9, areaM2: area, neighbours: [], seed })).toBeGreaterThanOrEqual(9);
  });

  it("is the same every time for the same building", () => {
    const input = { dataHeight: 6, areaM2: 400, neighbours: [12, 15], seed: 42 };
    expect(inferHeight(input)).toBe(inferHeight(input));
  });
});

describe("orientedBox", () => {
  it("fits a rotated rectangle exactly, long side first", () => {
    const a = Math.PI / 6;
    const ring = rect(20, 8).map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)] as [number, number]);
    const box = orientedBox(ring);
    expect(box.long).toBeCloseTo(20, 4);
    expect(box.short).toBeCloseTo(8, 4);
    expect(box.rectangularity).toBeCloseTo(1, 4);
  });

  it("says how far an L-shape is from its box", () => {
    expect(orientedBox(ell).rectangularity).toBeCloseTo(500 / 900, 2);
  });
});

describe("roofFor (invented by region and type)", () => {
  it("gives a low Kyoto house a pitched tiled roof: gabled when long, hipped when squarish", () => {
    expect(roofFor({ height: 7, areaM2: 80, rectangularity: 0.97, aspect: 2.2, region: "japan" })).toBe("gable");
    expect(roofFor({ height: 7, areaM2: 80, rectangularity: 0.97, aspect: 1.1, region: "japan" })).toBe("hip");
  });

  it("gives towers a flat roof behind a parapet, and odd shapes a flat roof", () => {
    expect(roofFor({ height: 30, areaM2: 600, rectangularity: 0.98, aspect: 1.5, region: "japan" })).toBe("parapet");
    expect(roofFor({ height: 7, areaM2: 300, rectangularity: 0.55, aspect: 1, region: "japan" })).toBe("flat");
  });

  it("keeps pitched roofs to the regions that build them", () => {
    expect(roofFor({ height: 7, areaM2: 80, rectangularity: 0.97, aspect: 2.2, region: "other" })).toBe("flat");
  });
});

describe("buildingMass", () => {
  const ctx = { metresPerUnit: 1, region: "japan" as const, seed: 7 };

  it("puts a gable's ridge along the long side, above the eaves", () => {
    const mass = buildingMass({ rings: [rect(16, 6)], height: 7, minHeight: 0 }, { ...ctx, neighbours: [] });
    expect(mass.roof).toBe("gable");
    const ridge = segments(mass.edges).filter((s) => s[2] === s[5] && s[2] > mass.eave + 0.5);
    expect(ridge).toHaveLength(1);
    const [x1, y1, , x2, y2] = ridge[0];
    expect(Math.hypot(x2 - x1, y2 - y1)).toBeCloseTo(16, 3);
    expect(y1).toBeCloseTo(3, 3);
  });

  it("shortens a hip roof's ridge and draws its four hips", () => {
    const mass = buildingMass({ rings: [rect(10, 9)], height: 7, minHeight: 0 }, { ...ctx, neighbours: [] });
    expect(mass.roof).toBe("hip");
    const top = Math.max(...segments(mass.edges).flatMap((s) => [s[2], s[5]]));
    const ridge = segments(mass.edges).filter((s) => s[2] === top && s[5] === top);
    expect(ridge).toHaveLength(1);
    const hips = segments(mass.edges).filter((s) => (s[2] === top) !== (s[5] === top) && Math.min(s[2], s[5]) === mass.eave);
    expect(hips).toHaveLength(4);
  });

  it("draws a parapet round a tower's flat roof", () => {
    const mass = buildingMass({ rings: [rect(30, 20)], height: 36, minHeight: 0 }, { ...ctx, neighbours: [] });
    expect(mass.roof).toBe("parapet");
    // The parapet's inner line stands inside the outer one, at the roof.
    const inner = segments(mass.edges).filter((s) => s[2] === s[5] && s[0] > 0.1 && s[0] < 29.9 && s[1] > 0.1 && s[1] < 19.9 && s[3] > 0.1 && s[3] < 29.9);
    expect(inner.length).toBeGreaterThanOrEqual(4);
  });

  it("marks walls with their storeys for the facade drawing, roofs as roofs", () => {
    const mass = buildingMass({ rings: [rect(16, 6)], height: 7, minHeight: 0 }, { ...ctx, neighbours: [] });
    const kinds = new Set<number>();
    for (let i = 0; i < mass.faces.length; i += MASS_STRIDE) kinds.add(mass.faces[i + 6]);
    expect(kinds).toEqual(new Set([FACE.houseWall, FACE.tiledRoof, FACE.gable]));
    // Each wall vertex carries its distance along the wall and its height, in metres.
    for (let i = 0; i < mass.faces.length; i += MASS_STRIDE) if (mass.faces[i + 6] === FACE.houseWall) expect(mass.faces[i + 4]).toBe(mass.faces[i + 2]);
  });

  it("keeps an odd footprint's own walls, with a flat roof", () => {
    // A height the data really gives (above 7.5 m), so none is invented.
    const mass = buildingMass({ rings: [ell], height: 8, minHeight: 0 }, { ...ctx, neighbours: [] });
    expect(mass.roof).toBe("flat");
    const corners = segments(mass.edges).filter((s) => s[0] === s[3] && s[1] === s[4]);
    expect(corners).toHaveLength(6);
  });
});

describe("packFaces", () => {
  it("packs each vertex into 20 bytes, keeping position exact and the rest close", () => {
    const mass = buildingMass({ rings: [rect(16, 6)], height: 7, minHeight: 0 }, { metresPerUnit: 1, region: "japan", seed: 7, neighbours: [], explored: { strength: 0.5, colour: 3 } });
    const packed = packFaces(mass.faces);
    const vertices = mass.faces.length / MASS_STRIDE;
    expect(packed.byteLength).toBe(vertices * PACKED_BYTES);
    const view = new DataView(packed);
    for (let v = 0; v < vertices; v += 1) {
      const o = v * PACKED_BYTES;
      const f = v * MASS_STRIDE;
      expect(view.getFloat32(o, true)).toBeCloseTo(mass.faces[f], 5);
      expect(view.getFloat32(o + 8, true)).toBeCloseTo(mass.faces[f + 2], 5);
      expect(halfToFloat(view.getUint16(o + 12, true))).toBeCloseTo(mass.faces[f + 3], 1);
      expect(view.getUint8(o + 17)).toBe(mass.faces[f + 6]);
      expect(view.getUint8(o + 18) / 255).toBeCloseTo(0.5, 2);
      expect(view.getUint8(o + 19)).toBe(3);
    }
  });

  it("marks a building that is not explored with no colour", () => {
    const mass = buildingMass({ rings: [rect(16, 6)], height: 7, minHeight: 0 }, { metresPerUnit: 1, region: "japan", seed: 7, neighbours: [] });
    expect(new DataView(packFaces(mass.faces)).getUint8(19)).toBe(255);
  });
});
