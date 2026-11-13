// Reads what the sketch needs from a Mapbox Vector Tile: building footprints
// with their heights, for the edge layer, and which features lie near her
// routes, for the colour reveal. A small protobuf reader, so no decoding
// library has to be added.

export interface TileBuilding {
  /** Outer ring first, then its courtyards; tile units, closed. */
  rings: [number, number][][];
  height: number;
  minHeight: number;
  extent: number;
}

/** The height MapLibre's style gives a building without one, in metres. */
const DEFAULT_HEIGHT = 6;

class Reader {
  pos = 0;
  readonly buf: Uint8Array;
  constructor(buf: Uint8Array) {
    this.buf = buf;
  }
  get done() {
    return this.pos >= this.buf.length;
  }
  varint(): number {
    let result = 0;
    let shift = 0;
    for (;;) {
      const byte = this.buf[this.pos++];
      // Past 2^31 multiplying keeps it exact where shifting would not.
      result += (byte & 127) * 2 ** shift;
      if (byte < 128) return result;
      shift += 7;
    }
  }
  sub(): Reader {
    const length = this.varint();
    const reader = new Reader(this.buf.subarray(this.pos, this.pos + length));
    this.pos += length;
    return reader;
  }
  skip(wire: number) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) this.pos += this.varint();
    else if (wire === 5) this.pos += 4;
    else throw new Error(`Unknown wire type ${wire}`);
  }
  packed(): number[] {
    const reader = this.sub();
    const out: number[] = [];
    while (!reader.done) out.push(reader.varint());
    return out;
  }
}

type Value = string | number | boolean;

function readValue(reader: Reader): Value {
  let value: Value = 0;
  while (!reader.done) {
    const tag = reader.varint();
    const field = tag >> 3;
    const wire = tag & 7;
    if (field === 1) value = new TextDecoder().decode(reader.sub().buf);
    else if (field === 2) {
      value = new DataView(reader.buf.buffer, reader.buf.byteOffset + reader.pos, 4).getFloat32(0, true);
      reader.pos += 4;
    } else if (field === 3) {
      value = new DataView(reader.buf.buffer, reader.buf.byteOffset + reader.pos, 8).getFloat64(0, true);
      reader.pos += 8;
    } else if (field === 4 || field === 5) value = reader.varint();
    else if (field === 6) {
      const n = reader.varint();
      value = n % 2 === 0 ? n / 2 : -(n + 1) / 2;
    } else if (field === 7) value = reader.varint() === 1;
    else reader.skip(wire);
  }
  return value;
}

const unzig = (n: number) => (n >>> 1) ^ -(n & 1);

/** A feature's rings (closed) or lines (open) from its geometry commands. */
function decodeRings(commands: number[], closed: boolean): [number, number][][] {
  const rings: [number, number][][] = [];
  let ring: [number, number][] = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i < commands.length; ) {
    const command = commands[i] & 7;
    const count = commands[i] >> 3;
    i += 1;
    if (command === 7) {
      if (ring.length > 2) rings.push([...ring, ring[0]]);
      ring = [];
      continue;
    }
    for (let k = 0; k < count; k += 1) {
      x += unzig(commands[i]);
      y += unzig(commands[i + 1]);
      i += 2;
      if (command === 1) {
        if (!closed && ring.length > 1) rings.push(ring);
        ring = [[x, y]];
      } else ring.push([x, y]);
    }
  }
  if (!closed && ring.length > 1) rings.push(ring);
  return rings;
}

/** Twice the ring's signed area; positive for an outer ring in tile space. */
const signedArea = (ring: [number, number][]) => {
  let sum = 0;
  for (let i = 1; i < ring.length; i += 1) sum += ring[i - 1][0] * ring[i][1] - ring[i][0] * ring[i - 1][1];
  return sum;
};

interface RawFeature {
  id: number;
  type: number;
  props: Record<string, Value>;
  geometry: number[];
}

/** The named layers of a tile: each one's extent and features, geometry still encoded. */
function readLayers(data: Uint8Array, names: readonly string[]) {
  const tile = new Reader(data);
  const out = new Map<string, { extent: number; features: RawFeature[] }>();
  while (!tile.done) {
    const tag = tile.varint();
    if (tag >> 3 !== 3 || (tag & 7) !== 2) {
      tile.skip(tag & 7);
      continue;
    }
    const layer = tile.sub();
    let name = "";
    let extent = 4096;
    const keys: string[] = [];
    const values: Value[] = [];
    const features: { id: number; tags: number[]; type: number; geometry: number[] }[] = [];
    while (!layer.done) {
      const ltag = layer.varint();
      const field = ltag >> 3;
      if (field === 1) {
        name = new TextDecoder().decode(layer.sub().buf);
        // Not a layer we want: skip the rest of it unread.
        if (!names.includes(name)) break;
      } else if (field === 2) {
        const feature = layer.sub();
        const parsed = { id: 0, tags: [] as number[], type: 0, geometry: [] as number[] };
        while (!feature.done) {
          const ftag = feature.varint();
          const ffield = ftag >> 3;
          if (ffield === 1) parsed.id = feature.varint();
          else if (ffield === 2) parsed.tags = feature.packed();
          else if (ffield === 3) parsed.type = feature.varint();
          else if (ffield === 4) parsed.geometry = feature.packed();
          else feature.skip(ftag & 7);
        }
        features.push(parsed);
      } else if (field === 3) keys.push(new TextDecoder().decode(layer.sub().buf));
      else if (field === 4) values.push(readValue(layer.sub()));
      else if (field === 5) extent = layer.varint();
      else layer.skip(ltag & 7);
    }
    if (!names.includes(name)) continue;
    out.set(name, {
      extent,
      features: features.map((feature) => {
        const props: Record<string, Value> = {};
        for (let i = 0; i + 1 < feature.tags.length; i += 2) props[keys[feature.tags[i]]] = values[feature.tags[i + 1]];
        return { id: feature.id, type: feature.type, props, geometry: feature.geometry };
      }),
    });
  }
  return out;
}

export function readBuildings(data: Uint8Array): TileBuilding[] {
  const layer = readLayers(data, ["building"]).get("building");
  if (!layer) return [];
  const out: TileBuilding[] = [];
  for (const feature of layer.features) {
    if (feature.type !== 3 || feature.props.hide_3d === true) continue;
    const height = typeof feature.props.render_height === "number" ? feature.props.render_height : DEFAULT_HEIGHT;
    const minHeight = typeof feature.props.render_min_height === "number" ? feature.props.render_min_height : 0;
    let current: TileBuilding | null = null;
    for (const ring of decodeRings(feature.geometry, true)) {
      if (signedArea(ring) > 0 || !current) {
        current = { rings: [ring], height, minHeight, extent: layer.extent };
        out.push(current);
      } else current.rings.push(ring);
    }
  }
  return out;
}

/**
 * The layers whose features come into colour by feature. Buildings are not
 * among them: OpenFreeMap merges a tile's buildings into a few features, so
 * they are coloured building by building instead (see sketch-faces). Roads
 * are merged by name too, so a road stays ink and the ground round it colours;
 * woods are merged into whole hillsides, so they stay ink as well.
 */
export const REVEAL_LAYERS = ["water", "waterway", "park"];

export interface ExploredId {
  layer: string;
  id: number;
  /** 2 within half the radius of a route, 1 within the radius. */
  level: 1 | 2;
}

/** The squared distance from p to the segment a-b. */
function segmentDistance2(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const length2 = dx * dx + dy * dy;
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length2));
  const x = ax + t * dx - px;
  const y = ay + t * dy - py;
  return x * x + y * y;
}

/** Whether segments a-b and c-d cross. */
function crosses(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number) {
  const side = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) => Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px));
  return side(ax, ay, bx, by, cx, cy) !== side(ax, ay, bx, by, dx, dy) && side(cx, cy, dx, dy, ax, ay) !== side(cx, cy, dx, dy, bx, by);
}

/** Whether points with none inside a box still reach across it, as a long road does. */
function spans(points: [number, number][], box: number[]) {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return Math.min(...xs) <= box[2] && Math.max(...xs) >= box[0] && Math.min(...ys) <= box[3] && Math.max(...ys) >= box[1];
}

/**
 * The features of the named layers that lie within `radius` (tile units) of
 * the route lines (tile units): their ids, so the map can colour exactly
 * those. A feature counts by its nearest outline point or by crossing a
 * route, which a long road or a river does.
 */
export function exploredIds(data: Uint8Array, routeLines: readonly (readonly [number, number][])[], radius: number, layers: readonly string[]): ExploredId[] {
  const out: ExploredId[] = [];
  const near2 = radius * radius;
  const half2 = near2 / 4;
  const segments: number[][] = [];
  for (const line of routeLines) for (let i = 1; i < line.length; i += 1) segments.push([line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]]);
  if (!segments.length) return out;
  // The routes' box, grown by the radius: most features fall outside it.
  const xs = segments.flatMap((s) => [s[0], s[2]]);
  const ys = segments.flatMap((s) => [s[1], s[3]]);
  const box = [Math.min(...xs) - radius, Math.min(...ys) - radius, Math.max(...xs) + radius, Math.max(...ys) + radius];
  for (const [name, layer] of readLayers(data, layers)) {
    for (const feature of layer.features) {
      if (feature.type === 1) continue;
      const parts = decodeRings(feature.geometry, feature.type === 3);
      const points = parts.flat();
      if (!points.some(([x, y]) => x >= box[0] && y >= box[1] && x <= box[2] && y <= box[3]) && !spans(points, box)) continue;
      let best = Infinity;
      for (const part of parts) {
        for (let i = 0; i < part.length && best > 0; i += 1) {
          const [x, y] = part[i];
          for (const s of segments) best = Math.min(best, segmentDistance2(x, y, s[0], s[1], s[2], s[3]));
          if (i > 0) for (const s of segments) if (crosses(part[i - 1][0], part[i - 1][1], x, y, s[0], s[1], s[2], s[3])) best = 0;
        }
      }
      if (best <= half2) out.push({ layer: name, id: feature.id, level: 2 });
      else if (best <= near2) out.push({ layer: name, id: feature.id, level: 1 });
    }
  }
  return out;
}

/**
 * Drops the cut a tile makes through a building at its border: a segment
 * with both ends beyond the same side of the tile, or a corner standing
 * outside it. Lines that cross the border stay; the next tile draws the same
 * line, in the same place.
 */
export function dropTileEdges(edges: Float32Array, extent: number): Float32Array {
  const out: number[] = [];
  const outside = (x: number, y: number) => x < 0 || y < 0 || x > extent || y > extent;
  for (let i = 0; i < edges.length; i += 6) {
    const [x1, y1, , x2, y2] = [edges[i], edges[i + 1], edges[i + 2], edges[i + 3], edges[i + 4]];
    const beyond = (x1 < 0 && x2 < 0) || (y1 < 0 && y2 < 0) || (x1 > extent && x2 > extent) || (y1 > extent && y2 > extent);
    const strayCorner = x1 === x2 && y1 === y2 && outside(x1, y1);
    if (beyond || strayCorner) continue;
    for (let k = 0; k < 6; k += 1) out.push(edges[i + k]);
  }
  return new Float32Array(out);
}
