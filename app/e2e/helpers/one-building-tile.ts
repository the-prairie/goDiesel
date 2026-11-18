// A tiny vector tile for tests: one building footprint (about 35 m square at
// Kyoto, z14) with a minor street running along its south side. Served for
// every tile, so the same building stands in each. Tile units, extent 4096.

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

/** The footprint's corners in tile units: west, north, east, south. */
export const BUILDING = { west: 2000, north: 2000, east: 2060, south: 2060 };
const ROAD_Y = 2075;

function layer(name: string, type: 2 | 3, geometry: number[], props: [string, string][] = []) {
  const keys = props.map(([k]) => k);
  const values = props.map(([, v]) => v);
  const tags = props.flatMap((_, i) => [i, i]);
  const feature = bytes(2, [...uint(1, 1), ...(tags.length ? packed(2, tags) : []), ...uint(3, type), ...packed(4, geometry)]);
  return bytes(3, [...uint(15, 2), ...text(1, name), ...feature, ...keys.flatMap((k) => text(3, k)), ...values.flatMap((v) => bytes(4, text(1, v))), ...uint(5, 4096)]);
}

export function oneBuildingTile() {
  const { west, north, east, south } = BUILDING;
  // A closed ring, clockwise in tile space (y down): MoveTo, LineTo ×3, ClosePath.
  const ring = [9, zig(west), zig(north), 26, zig(east - west), 0, 0, zig(south - north), zig(west - east), 0, 15];
  const road = [9, zig(west - 100), zig(ROAD_Y), 10, zig(east - west + 200), 0];
  return Buffer.from([...layer("building", 3, ring), ...layer("transportation", 2, road, [["class", "minor"]])]);
}

/** The middle of the building in the given z14 tile, as lng/lat. */
export function buildingCentre(tileX: number, tileY: number) {
  const n = 2 ** 14;
  const x = tileX + (BUILDING.west + BUILDING.east) / 2 / 4096;
  const y = tileY + (BUILDING.north + BUILDING.south) / 2 / 4096;
  return { lng: (x / n) * 360 - 180, lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI };
}
