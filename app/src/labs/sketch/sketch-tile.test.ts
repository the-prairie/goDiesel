import { describe, expect, it } from "vitest";

import { dropTileEdges, exploredIds, readBuildings } from "@/labs/sketch/sketch-tile";

// A minimal protobuf writer, to build vector tiles for the tests.
const varint = (value: number) => {
  const out: number[] = [];
  let v = value >>> 0;
  while (v > 127) {
    out.push((v & 127) | 128);
    v >>>= 7;
  }
  out.push(v);
  return out;
};
const key = (field: number, wire: number) => varint((field << 3) | wire);
const bytes = (field: number, payload: number[]) => [...key(field, 2), ...varint(payload.length), ...payload];
const uint = (field: number, value: number) => [...key(field, 0), ...varint(value)];
const text = (field: number, value: string) => bytes(field, [...new TextEncoder().encode(value)]);
const zig = (n: number) => (n << 1) ^ (n >> 31);
const packed = (field: number, values: number[]) => bytes(field, values.flatMap((value) => varint(value)));
const double = (field: number, value: number) => {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value, true);
  return [...key(field, 1), ...new Uint8Array(view.buffer)];
};

/** Geometry commands for closed rings. */
function rings(list: [number, number][][]) {
  const out: number[] = [];
  let x = 0;
  let y = 0;
  for (const ring of list) {
    out.push((1 & 7) | (1 << 3), zig(ring[0][0] - x), zig(ring[0][1] - y));
    [x, y] = ring[0];
    out.push((2 & 7) | ((ring.length - 1) << 3));
    for (const [px, py] of ring.slice(1)) {
      out.push(zig(px - x), zig(py - y));
      [x, y] = [px, py];
    }
    out.push(7 | (1 << 3));
  }
  return out;
}

function tile(features: { rings: [number, number][][]; height?: number; min?: number; hide?: boolean }[]) {
  const keys = ["render_height", "render_min_height", "hide_3d"];
  const values: number[][] = [];
  const valueIndex = (payload: number[]) => {
    values.push(payload);
    return values.length - 1;
  };
  const featureBytes = features.map((feature, id) => {
    const tags: number[] = [];
    if (feature.height !== undefined) tags.push(0, valueIndex(double(3, feature.height)));
    if (feature.min !== undefined) tags.push(1, valueIndex(double(3, feature.min)));
    if (feature.hide) tags.push(2, valueIndex(uint(7, 1)));
    return bytes(2, [...uint(1, id + 1), ...packed(2, tags), ...uint(3, 3), ...packed(4, rings(feature.rings))]);
  });
  const layer = [...uint(15, 2), ...text(1, "building"), ...featureBytes.flat(), ...keys.flatMap((name) => text(3, name)), ...values.flatMap((value) => bytes(4, value)), ...uint(5, 4096)];
  const other = [...uint(15, 2), ...text(1, "water"), ...uint(5, 4096)];
  return new Uint8Array([...bytes(3, other), ...bytes(3, layer)]);
}

const box = (x: number, y: number, size: number): [number, number][] => [
  [x, y],
  [x + size, y],
  [x + size, y + size],
  [x, y + size],
  [x, y],
];

describe("readBuildings", () => {
  it("reads each building's rings and heights from the building layer only", () => {
    const buildings = readBuildings(tile([{ rings: [box(100, 100, 50)], height: 12.5, min: 3 }]));
    expect(buildings).toHaveLength(1);
    expect(buildings[0].height).toBe(12.5);
    expect(buildings[0].minHeight).toBe(3);
    expect(buildings[0].rings[0].slice(0, 4)).toEqual(box(100, 100, 50).slice(0, 4));
    expect(buildings[0].extent).toBe(4096);
  });

  it("gives a building without a height the map's default, and skips hidden ones", () => {
    const buildings = readBuildings(tile([{ rings: [box(0, 0, 10)] }, { rings: [box(20, 20, 10)], height: 30, hide: true }]));
    expect(buildings).toHaveLength(1);
    expect(buildings[0].height).toBe(6);
    expect(buildings[0].minHeight).toBe(0);
  });

  it("keeps a courtyard with its building, and starts a new building at each outer ring", () => {
    const outer = box(0, 0, 100);
    const hole = [...box(30, 30, 20)].reverse() as [number, number][];
    const [one, two] = readBuildings(tile([{ rings: [outer, hole, box(200, 200, 10)], height: 9 }]));
    expect(one.rings).toHaveLength(2);
    expect(two.rings).toHaveLength(1);
  });
});

describe("dropTileEdges", () => {
  it("drops the cut a tile makes along its border, keeps lines that cross it", () => {
    const edges = new Float32Array([
      // Along the cut, outside the tile on the left.
      -64, 10, 5, -64, 50, 5,
      // A wall crossing into the next tile.
      -20, 10, 5, 30, 10, 5,
      // A corner standing outside the tile.
      4100, 10, 0, 4100, 10, 5,
      // Inside.
      10, 10, 0, 10, 10, 5,
    ]);
    expect([...dropTileEdges(edges, 4096)]).toEqual([-20, 10, 5, 30, 10, 5, 10, 10, 0, 10, 10, 5]);
  });
});

describe("exploredIds", () => {
  /** A layer with line features (type 2), ids from 100. */
  function lineLayer(name: string, lines: [number, number][][]) {
    const featureBytes = lines.map((line, index) => {
      const commands: number[] = [];
      let x = 0;
      let y = 0;
      commands.push(1 | (1 << 3), zig(line[0][0] - x), zig(line[0][1] - y));
      [x, y] = line[0];
      commands.push(2 | ((line.length - 1) << 3));
      for (const [px, py] of line.slice(1)) {
        commands.push(zig(px - x), zig(py - y));
        [x, y] = [px, py];
      }
      return bytes(2, [...uint(1, 100 + index), ...uint(3, 2), ...packed(4, commands)]);
    });
    return bytes(3, [...uint(15, 2), ...text(1, name), ...featureBytes.flat(), ...uint(5, 4096)]);
  }

  it("names the features near the route, nearer ones at the closer level, by layer", () => {
    const buildings = tile([
      { rings: [box(100, 100, 20)], height: 9 },
      { rings: [box(100, 500, 20)], height: 9 },
      { rings: [box(100, 2000, 20)], height: 9 },
    ]);
    const roads = lineLayer("transportation", [
      [[0, 140], [4096, 140]],
      [[0, 3000], [4096, 3000]],
    ]);
    const data = new Uint8Array([...buildings, ...roads]);
    // The route runs along y = 140; near is 100 units, half-near 50.
    const found = exploredIds(data, [[[0, 140], [4096, 140]]], 100, ["building", "transportation"]);
    expect(found).toEqual([
      { layer: "building", id: 1, level: 2 },
      { layer: "transportation", id: 100, level: 2 },
    ]);
    const wider = exploredIds(data, [[[0, 140], [4096, 140]]], 600, ["building"]);
    expect(wider).toEqual([
      { layer: "building", id: 1, level: 2 },
      { layer: "building", id: 2, level: 1 },
    ]);
  });

  it("counts a road that crosses the route as near, though its ends are far", () => {
    const data = new Uint8Array(lineLayer("transportation", [[[2000, 0], [2000, 4000]]]));
    expect(exploredIds(data, [[[0, 1000], [4096, 1000]]], 50, ["transportation"])).toEqual([{ layer: "transportation", id: 100, level: 2 }]);
  });
});
