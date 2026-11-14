import { describe, expect, it } from "vitest";

import { FACE, MASS_STRIDE, PACKED_BYTES, buildingMass, halfToFloat, inferHeight, orientedBox, packFaces, regionRoof, roofFor } from "@/labs/sketch/sketch-massing";

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
  const house = { form: "house" as const, areaM2: 80, rectangularity: 0.97, aspect: 2.2 };

  it("gives a low Kyoto house a pitched tiled roof: gabled when long, hipped when squarish", () => {
    expect(roofFor({ ...house, region: "japan" })).toBe("gable");
    expect(roofFor({ ...house, aspect: 1.1, region: "japan" })).toBe("hip");
  });

  it("follows each region's houses: low hips by the Mediterranean, flat whitewash in the Aegean, steep gables in the north, gables in North America", () => {
    expect(roofFor({ ...house, region: "mediterranean" })).toBe("hip");
    expect(roofFor({ ...house, region: "aegean" })).toBe("flat");
    expect(roofFor({ ...house, region: "northern-europe" })).toBe("gable");
    expect(roofFor({ ...house, region: "north-america" })).toBe("gable");
    expect(roofFor({ ...house, aspect: 1.1, region: "other" })).toBe("hip");
  });

  it("gives blocks, mansions and towers a flat roof behind a parapet, sheds a sheet roof", () => {
    for (const form of ["block", "mansion", "tower", "institution", "retail"] as const) expect(roofFor({ ...house, form, region: "japan" })).toBe("parapet");
    expect(roofFor({ ...house, form: "shed", region: "japan" })).toBe("sheet");
  });

  it("gives a low Mediterranean block a low hipped roof, as Italian and Spanish blocks have", () => {
    expect(roofFor({ ...house, form: "block", areaM2: 600, aspect: 1.6, region: "mediterranean", height: 16 })).toBe("hip");
    expect(roofFor({ ...house, form: "block", areaM2: 600, rectangularity: 0.6, aspect: 1.6, region: "mediterranean", height: 16 })).toBe("parapet");
    expect(roofFor({ ...house, form: "block", areaM2: 600, aspect: 1.6, region: "mediterranean", height: 26 })).toBe("parapet");
    expect(roofFor({ ...house, form: "block", areaM2: 600, aspect: 1.6, region: "north-america", height: 16 })).toBe("parapet");
  });

  it("gives landmarks their own roofs", () => {
    expect(roofFor({ ...house, region: "japan", landmark: "temple" })).toBe("irimoya");
    expect(roofFor({ ...house, region: "japan", landmark: "shrine" })).toBe("gable");
    expect(roofFor({ ...house, region: "mediterranean", landmark: "church" })).toBe("steep");
  });

  it("gives each region its eaves and pitch", () => {
    expect(regionRoof("japan").eaveM).toBe(0.7);
    expect(regionRoof("northern-europe").pitch).toBeGreaterThan(regionRoof("mediterranean").pitch);
  });
});

describe("buildingMass", () => {
  const ctx = { metresPerUnit: 1, region: "japan" as const, seed: 7 };
  const kindsOf = (faces: Float32Array) => {
    const kinds = new Set<number>();
    for (let i = 0; i < faces.length; i += MASS_STRIDE) kinds.add(faces[i + 6]);
    return kinds;
  };
  /** The kinds of the triangles whose three corners all pass the test. */
  const kindAt = (faces: Float32Array, test: (x: number, y: number, z: number) => boolean) => {
    const kinds = new Set<number>();
    const triangle = MASS_STRIDE * 3;
    for (let t = 0; t < faces.length; t += triangle) {
      const corners = [0, 1, 2].map((k) => t + k * MASS_STRIDE);
      if (corners.every((i) => test(faces[i], faces[i + 1], faces[i + 2]))) kinds.add(faces[t + 6]);
    }
    return kinds;
  };

  it("puts a gable's ridge along the long side, above the eaves, running out over the gables", () => {
    const mass = buildingMass({ rings: [rect(16, 6)], height: 7, minHeight: 0 }, { ...ctx, neighbours: [] });
    expect(mass.roof).toBe("gable");
    const ridge = segments(mass.edges).filter((s) => s[2] === s[5] && s[2] > mass.eave + 0.5);
    expect(ridge).toHaveLength(1);
    const [x1, y1, , x2, y2] = ridge[0];
    expect(Math.hypot(x2 - x1, y2 - y1)).toBeCloseTo(16 + 2 * 0.7, 3);
    expect(y1).toBeCloseTo(3, 3);
  });

  it("gives a Kyoto house eaves 0.7 m deep, at no cost in triangles", () => {
    const mass = buildingMass({ rings: [rect(16, 6)], height: 7, minHeight: 0 }, { ...ctx, neighbours: [] });
    const xs = segments(mass.edges).flatMap((s) => [s[0], s[3]]);
    expect(Math.min(...xs)).toBeCloseTo(-0.7, 3);
    expect(Math.max(...xs)).toBeCloseTo(16.7, 3);
    // Four walls, two roof planes, two gable ends: no soffit underneath.
    expect(mass.faces.length / MASS_STRIDE / 3).toBe(4 * 2 + 2 * 2 + 2);
  });

  it("shortens a hip roof's ridge and draws its four hips down to the eaves", () => {
    const mass = buildingMass({ rings: [rect(10, 9)], height: 7, minHeight: 0 }, { ...ctx, neighbours: [] });
    expect(mass.roof).toBe("hip");
    const top = Math.max(...segments(mass.edges).flatMap((s) => [s[2], s[5]]));
    const ridge = segments(mass.edges).filter((s) => s[2] === top && s[5] === top);
    expect(ridge).toHaveLength(1);
    const hips = segments(mass.edges).filter((s) => (s[2] === top) !== (s[5] === top) && Math.min(s[2], s[5]) < mass.eave);
    expect(hips).toHaveLength(4);
  });

  it("draws a parapet round a block's flat roof", () => {
    const mass = buildingMass({ rings: [rect(30, 20)], height: 36, minHeight: 0 }, { ...ctx, neighbours: [] });
    expect(mass.roof).toBe("parapet");
    const inner = segments(mass.edges).filter((s) => s[2] === s[5] && s[0] > 0.1 && s[0] < 29.9 && s[1] > 0.1 && s[1] < 19.9 && s[3] > 0.1 && s[3] < 29.9);
    expect(inner.length).toBeGreaterThanOrEqual(4);
  });

  it("draws a Kyoto mansion block: balconies on its long faces, blank end walls, a plant room on the roof", () => {
    const mass = buildingMass({ rings: [rect(40, 12)], height: 21, minHeight: 0 }, { ...ctx, neighbours: [] });
    expect(mass.form).toBe("mansion");
    // Long faces run along x (y = 0 and y = 12); ends at x = 0 and x = 40.
    expect(kindAt(mass.faces, (x, y, z) => y === 0 && z <= 22)).toEqual(new Set([FACE.balcony]));
    expect(kindAt(mass.faces, (x, y, z) => x === 0 && z <= 22)).toEqual(new Set([FACE.blank]));
    const roofTop = Math.max(...Array.from({ length: mass.faces.length / MASS_STRIDE }, (_, v) => mass.faces[v * MASS_STRIDE + 2]));
    expect(roofTop).toBeGreaterThan(21 + 2);
  });

  it("marks a house's walls with their storeys, roofs as roofs", () => {
    const mass = buildingMass({ rings: [rect(16, 6)], height: 7, minHeight: 0 }, { ...ctx, neighbours: [] });
    expect(kindsOf(mass.faces)).toEqual(new Set([FACE.houseWall, FACE.tiledRoof, FACE.gable]));
    for (let i = 0; i < mass.faces.length; i += MASS_STRIDE) if (mass.faces[i + 6] === FACE.houseWall) expect(mass.faces[i + 4]).toBe(mass.faces[i + 2]);
  });

  it("keeps an odd footprint's own walls, with a flat roof", () => {
    const mass = buildingMass({ rings: [ell], height: 8, minHeight: 0 }, { ...ctx, neighbours: [] });
    expect(mass.roof).toBe("flat");
    const corners = segments(mass.edges).filter((s) => s[0] === s[3] && s[1] === s[4]);
    expect(corners).toHaveLength(6);
  });

  it("draws a temple low under a big roof with deep eaves", () => {
    const mass = buildingMass({ rings: [rect(20, 14)], height: 12, minHeight: 0 }, { ...ctx, neighbours: [], landmark: "temple" });
    expect(mass.roof).toBe("irimoya");
    expect(kindsOf(mass.faces).has(FACE.temple)).toBe(true);
    expect(mass.eave).toBeLessThanOrEqual(6);
    const xs = segments(mass.edges).flatMap((s) => [s[0], s[3]]);
    expect(Math.min(...xs)).toBeLessThanOrEqual(-1.4);
    const top = Math.max(...segments(mass.edges).flatMap((s) => [s[2], s[5]]));
    expect(top - mass.eave).toBeGreaterThan(5);
  });

  it("draws a church with a steep roof and a tower above it", () => {
    const mass = buildingMass({ rings: [rect(30, 12)], height: 12, minHeight: 0 }, { ...ctx, region: "mediterranean", neighbours: [], landmark: "church" });
    expect(mass.roof).toBe("steep");
    expect(kindsOf(mass.faces).has(FACE.church)).toBe(true);
    const ridge = segments(mass.edges).filter((s) => s[2] === s[5] && s[2] > mass.eave + 0.5).map((s) => s[2]);
    const top = Math.max(...segments(mass.edges).flatMap((s) => [s[2], s[5]]));
    expect(top).toBeGreaterThan(Math.max(...ridge) + 6);
  });

  it("draws a shed on industrial land with sheet walls and roof", () => {
    const mass = buildingMass({ rings: [rect(60, 30)], height: 9, minHeight: 0 }, { ...ctx, neighbours: [], landuse: "industrial" });
    expect(mass.form).toBe("shed");
    expect(kindsOf(mass.faces)).toEqual(new Set([FACE.shed, FACE.sheetRoof]));
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
