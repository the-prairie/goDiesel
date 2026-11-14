// The city close up: a MapLibre custom layer that draws each building near
// the camera itself, as paper forms with roofs and drawn facades (INVENTED by
// rule, see sketch-massing), and their edges as anti-aliased ink lines of a
// fixed width on screen. Our forms are never lower than the data's, so
// MapLibre's own white boxes, which stay for the far city, are hidden inside
// them. The lines are geometry, so they hold steady as the camera moves; a
// line too short to read on screen fades out rather than shimmering, and a
// facade pattern too fine to read fades out too. The pencil look shifts each
// end of a stroke a little, lets it overshoot its corner and draws a second,
// fainter stroke.

import type { CustomLayerInterface, CustomRenderMethodInput, Map as MapLibreMap } from "maplibre-gl";

import type { EdgeRequest, EdgeResponse } from "@/labs/sketch/sketch-edge-worker";
import { BUILDING_COLOURS } from "@/labs/sketch/sketch-faces";
import { PACKED_BYTES } from "@/labs/sketch/sketch-massing";
import type { ExploredId } from "@/labs/sketch/sketch-tile";
import { routeOnGround } from "@/labs/sketch/sketch-route-ground";
import { tilesToDraw } from "@/labs/sketch/sketch-tiles";
import type { SketchLook } from "@/labs/sketch/sketch-options";

/** Building tiles are made at zoom 14 and drawn larger from there. */
const TILE_ZOOM = 14;
/** Edges start to draw here and are fully in by the next half level. */
const EDGE_MIN_ZOOM = 15;
/** Explored buildings come into colour as the white forms stand up. */
const FACE_MIN_ZOOM = 14.6;
/** Tiles are read from here in, for the colour reveal and the edges to come. */
const TILE_MIN_ZOOM = 14;

const STROKE: Record<SketchLook, { colour: [number, number, number]; paper: [number, number, number]; width: number; wobble: number; overshoot: number; second: number }> = {
  line: { colour: [0.11, 0.11, 0.12], paper: [1, 1, 0.995], width: 1.15, wobble: 0, overshoot: 0, second: 0 },
  pencil: { colour: [0.27, 0.26, 0.24], paper: [0.975, 0.965, 0.935], width: 1.05, wobble: 1.3, overshoot: 3, second: 0.42 },
};

/** Her route close up: the one red, a few pixels wide, not a stripe. */
const ROUTE_RED: [number, number, number] = [0.85, 0.255, 0.17];
const ROUTE_WIDTH_PX = 3.2;

/** The real colours explored buildings come back in, padded to the shader's eight. */
const PALETTE = new Float32Array(Array.from({ length: 8 }, (_, i) => BUILDING_COLOURS[i % BUILDING_COLOURS.length]).flat());

const VERTEX = `#version 300 es
in vec2 a_corner;
in vec3 a_from;
in vec3 a_to;
uniform mat4 u_matrix;
uniform vec2 u_viewport;
uniform float u_width;
uniform float u_wobble;
uniform float u_overshoot;
uniform float u_seed;
uniform float u_bias;
uniform vec2 u_fade;
out float v_side;
out float v_alpha;
float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719)) + u_seed) * 43758.5453); }
void main() {
  vec4 ca = u_matrix * vec4(a_from, 1.0);
  vec4 cb = u_matrix * vec4(a_to, 1.0);
  const float near = 1e-4;
  if (ca.w < near && cb.w < near) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  if (ca.w < near) ca = mix(ca, cb, (near - ca.w) / (cb.w - ca.w));
  if (cb.w < near) cb = mix(cb, ca, (near - cb.w) / (ca.w - cb.w));
  vec2 sa = ca.xy / ca.w * 0.5 * u_viewport;
  vec2 sb = cb.xy / cb.w * 0.5 * u_viewport;
  vec2 d = sb - sa;
  float len = length(d);
  vec2 dir = len > 1e-4 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  vec2 pa = sa + nrm * (hash(a_from) - 0.5) * 2.0 * u_wobble - dir * u_overshoot * hash(a_from + 1.7);
  vec2 pb = sb + nrm * (hash(a_to + 0.37) - 0.5) * 2.0 * u_wobble + dir * u_overshoot * hash(a_to + 2.3);
  vec4 c = mix(ca, cb, a_corner.x);
  float halfWidth = u_width * 0.5 + 1.0;
  vec2 p = mix(pa, pb, a_corner.x) + nrm * a_corner.y * halfWidth;
  // A hair towards the camera, so an edge wins over the face it bounds: a
  // fixed share of its distance, which in perspective depth is a share of
  // what is left to the far plane.
  float ndc = c.z / c.w;
  float biased = ndc - u_bias * (1.0 - ndc);
  gl_Position = vec4(p / (0.5 * u_viewport) * c.w, biased * c.w, c.w);
  v_side = a_corner.y * halfWidth;
  // Short strokes and far ones fade, so a distant district stays paper, not ink.
  v_alpha = smoothstep(4.0, 16.0, len) * (1.0 - smoothstep(u_fade.x, u_fade.y, c.w));
}`;

const FRAGMENT = `#version 300 es
precision highp float;
in float v_side;
in float v_alpha;
uniform vec4 u_colour;
uniform float u_width;
out vec4 fragColor;
void main() {
  float coverage = clamp(u_width * 0.5 + 0.5 - abs(v_side), 0.0, 1.0);
  float a = u_colour.a * coverage * v_alpha;
  fragColor = vec4(u_colour.rgb * a, a);
}`;

const FACE_VERTEX = `#version 300 es
in vec3 a_pos;
in vec2 a_uv;
in float a_shade;
in float a_kind;
in float a_strength;
in float a_colour;
uniform mat4 u_matrix;
uniform float u_bias;
out vec2 v_uv;
out float v_shade;
flat out int v_kind;
out float v_strength;
flat out int v_colour;
void main() {
  vec4 c = u_matrix * vec4(a_pos, 1.0);
  float ndc = c.z / c.w;
  gl_Position = vec4(c.xy, (ndc - u_bias * (1.0 - ndc)) * c.w, c.w);
  v_uv = a_uv;
  v_shade = a_shade;
  v_kind = int(a_kind + 0.5);
  v_strength = a_strength;
  v_colour = int(a_colour + 0.5);
}`;

// Facades drawn by rule (INVENTED detail): floor lines, windows in bays,
// shopfronts on a tower's ground floor, lattice and a door on a house's,
// rows of tiles on pitched roofs. Each pattern fades out before it is too
// fine to draw, so it never turns to moire.
const FACE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
in float v_shade;
flat in int v_kind;
in float v_strength;
flat in int v_colour;
uniform vec3 u_paper;
uniform vec3 u_ink;
uniform vec3 u_palette[8];
out vec4 fragColor;

// A line every 'spacing' metres along 'coord', 'px' pixels wide.
float lines(float coord, float spacing, float px) {
  float w = fwidth(coord);
  float d = abs(fract(coord / spacing + 0.5) - 0.5) * spacing;
  return (1.0 - smoothstep(px * w * 0.5, px * w * 0.5 + w, d)) * (1.0 - smoothstep(spacing * 0.15, spacing * 0.35, w));
}
// Inside the box [a, b] on both axes of a repeating cell.
float within(vec2 cell, vec2 a, vec2 b) {
  vec2 w = fwidth(cell);
  vec2 lo = smoothstep(a - w, a, cell);
  vec2 hi = 1.0 - smoothstep(b, b + w, cell);
  return lo.x * lo.y * hi.x * hi.y;
}
// The outline of that box.
float frame(vec2 cell, vec2 a, vec2 b, float px) {
  vec2 w = fwidth(cell) * px;
  float outer = within(cell, a - w * 0.5, b + w * 0.5);
  float inner = within(cell, a + w * 0.5, b - w * 0.5);
  return clamp(outer - inner, 0.0, 1.0);
}
float fadeAt(float size) {
  return 1.0 - smoothstep(size * 0.08, size * 0.2, max(fwidth(v_uv.x), fwidth(v_uv.y)));
}

void main() {
  vec3 base = u_paper;
  // Colour 255 (or anything past the palette) is a building not explored.
  if (v_colour < 8) base = mix(u_paper, u_palette[v_colour], v_strength);
  float ink = 0.0;
  float glass = 0.0;
  vec2 uv = v_uv;
  if (v_kind == 2) {
    // A tower: storeys of 3.4 m, bays of 2.6 m, a shopfront at street level.
    float storey = 3.4;
    float bay = 2.6;
    vec2 cell = vec2(mod(uv.x, bay), mod(uv.y, storey));
    float fade = fadeAt(storey);
    if (uv.y < storey) {
      vec2 shop = vec2(mod(uv.x, 5.2), uv.y);
      ink = max(ink, frame(shop, vec2(0.35, 0.25), vec2(4.85, 2.9), 1.0) * fade);
      glass = within(shop, vec2(0.35, 0.25), vec2(4.85, 2.9)) * 0.5 * fade;
    } else {
      ink = max(ink, lines(uv.y, storey, 0.8) * fade * 0.8);
      ink = max(ink, frame(cell, vec2(0.45, 0.9), vec2(2.15, 2.6), 0.9) * fade);
      glass = within(cell, vec2(0.45, 0.9), vec2(2.15, 2.6)) * 0.35 * fade;
    }
  } else if (v_kind == 1) {
    // A house: storeys of 2.9 m, a window in each 3.6 m bay; on the ground
    // floor a slatted lattice and, every 7 m, a door.
    float storey = 2.9;
    vec2 cell = vec2(mod(uv.x, 3.6), mod(uv.y, storey));
    float fade = fadeAt(storey);
    if (uv.y < storey) {
      vec2 front = vec2(mod(uv.x, 7.0), uv.y);
      float door = frame(front, vec2(3.0, 0.0), vec2(4.0, 2.1), 1.0);
      float lattice = within(front, vec2(0.6, 0.7), vec2(2.4, 2.2)) * lines(uv.x, 0.14, 0.7) * fadeAt(0.5);
      ink = max(ink, max(door, frame(front, vec2(0.6, 0.7), vec2(2.4, 2.2), 0.9)) * fade);
      ink = max(ink, lattice * 0.7);
    } else {
      ink = max(ink, frame(cell, vec2(1.0, 0.8), vec2(2.6, 2.0), 0.9) * fade);
      glass = within(cell, vec2(1.0, 0.8), vec2(2.6, 2.0)) * 0.3 * fade;
    }
    ink = max(ink, lines(uv.y, storey, 0.6) * fade * 0.5 * step(storey * 0.5, uv.y));
  } else if (v_kind == 3) {
    // Tiled roof: rows up the slope, ribs along it, lighter.
    ink = max(lines(uv.y, 0.32, 0.7) * 0.55, lines(uv.x, 0.26, 0.5) * 0.25) * fadeAt(0.32 * 4.0);
  }
  vec3 colour = base * v_shade;
  colour = mix(colour, mix(colour, vec3(0.86, 0.88, 0.9) * v_shade, 0.6), glass);
  colour = mix(colour, u_ink, clamp(ink, 0.0, 1.0) * 0.85);
  fragColor = vec4(colour, 1.0);
}`;

/** One tile's buildings on the GPU: their faces and their edges. */
interface TileDrawing {
  version: number;
  extent: number;
  edgeCount: number;
  edgeVao: WebGLVertexArrayObject;
  edgeBuffer: WebGLBuffer;
  faceCount: number;
  faceVao: WebGLVertexArrayObject;
  faceBuffer: WebGLBuffer;
  usedAt: number;
}

export interface EdgeStats {
  tiles: number;
  segments: number;
  pending: number;
  explored: number;
  revealedTiles: number;
  triangles: number;
}

function multiply(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
  const out = new Float64Array(16);
  for (let col = 0; col < 4; col += 1)
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  return out;
}

/**
 * How far towards the camera an edge is pulled, as a share of the depth
 * left: enough to win over the face it bounds, not enough to show through a
 * building in front (0.003 let corners show through; 0.0005 was clean).
 */
const EDGE_BIAS = 0.0008;
const edgeBias = () => EDGE_BIAS;

const tileKey = (x: number, y: number) => `${TILE_ZOOM}/${x}/${y}`;

export interface Reveal {
  lines: [number, number][][];
  radiusM: number;
  /** Whether colour fades towards the reveal's edge (the wash) or stops sharp. */
  fade: boolean;
}

export function createEdgeLayer({
  tilesUrl,
  look,
  maxTiles,
  onExplored,
}: {
  tilesUrl: string;
  look: SketchLook;
  maxTiles: number;
  /** Water and parks near her routes, found in a tile, for the map to colour. */
  onExplored: (ids: ExploredId[]) => void;
}) {
  // The reveal, versioned: a tile drawn for an older version is drawn again.
  let reveal: (Reveal & { version: number }) | null = null;
  let version = 0;
  let exploredCount = 0;
  let map: MapLibreMap | null = null;
  let gl: WebGL2RenderingContext | null = null;
  let program: WebGLProgram | null = null;
  let faceProgram: WebGLProgram | null = null;
  let corners: WebGLBuffer | null = null;
  let worker: Worker | null = null;
  let stroke = STROKE[look];
  const tiles = new Map<string, TileDrawing>();
  // Tiles made by the worker, waiting to be uploaded inside `render`, where
  // MapLibre expects GL state to change and restores its own afterwards.
  const arrived: { key: string; edges: Float32Array; faces: ArrayBuffer; extent: number; version: number }[] = [];
  const pending = new Map<string, number>();
  const failed = new Set<string>();
  const uniforms: Record<string, WebGLUniformLocation | null> = {};
  // Her routes on the ground, in the units of the tile they start in.
  let routeData: { key: string; segments: Float32Array } | null = null;
  let routeDrawing: { key: string; count: number; vao: WebGLVertexArrayObject; buffer: WebGLBuffer } | null = null;
  let routeDirty = false;
  // Hidden under the real city: nothing to draw.
  let paused = false;

  const want = () => {
    if (!map || !worker || map.getZoom() < TILE_MIN_ZOOM) return [];
    const n = 2 ** TILE_ZOOM;
    const center = map.getCenter();
    const sin = Math.sin((center.lat * Math.PI) / 180);
    const middle: [number, number] = [((center.lng + 180) / 360) * n, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * n];
    // The ground at the foot of the screen: where the nearest buildings stand.
    const canvas = map.getCanvas();
    const foot = map.unproject([canvas.clientWidth / 2, canvas.clientHeight]);
    const footSin = Math.sin((foot.lat * Math.PI) / 180);
    const camera: [number, number] = [((foot.lng + 180) / 360) * n, (0.5 - Math.log((1 + footSin) / (1 - footSin)) / (4 * Math.PI)) * n];
    return tilesToDraw({ camera, center: middle, maxTiles });
  };

  const request = (wanted: { x: number; y: number }[] = want()) => {
    if (!worker) return;
    for (const { x, y } of wanted) {
      const key = tileKey(x, y);
      if (failed.has(key) || pending.get(key) === version) continue;
      if (tiles.get(key)?.version === version || arrived.some((item) => item.key === key && item.version === version)) continue;
      pending.set(key, version);
      const url = tilesUrl.replace("{z}", String(TILE_ZOOM)).replace("{x}", String(x)).replace("{y}", String(y));
      worker!.postMessage({
        key,
        url,
        reveal: reveal ? { lines: reveal.lines, radiusM: reveal.radiusM, fade: reveal.fade, version } : null,
      } satisfies EdgeRequest);
    }
  };

  const receive = (event: MessageEvent<EdgeResponse>) => {
    const message = event.data;
    if (pending.get(message.key) !== undefined && !("error" in message) && message.version !== version && reveal) {
      // An answer for an older reveal: ask again.
      pending.delete(message.key);
      request();
      return;
    }
    pending.delete(message.key);
    if ("error" in message) {
      failed.add(message.key);
      return;
    }
    arrived.push({ key: message.key, edges: message.edges, faces: message.faces, extent: message.extent, version: reveal ? message.version : version });
    exploredCount += message.explored.length;
    onExplored(message.explored);
    map?.triggerRepaint();
    // Something may have been wanted while this tile was on its way.
    request();
  };

  const release = (g: WebGL2RenderingContext, tile: TileDrawing) => {
    g.deleteBuffer(tile.edgeBuffer);
    g.deleteVertexArray(tile.edgeVao);
    g.deleteBuffer(tile.faceBuffer);
    g.deleteVertexArray(tile.faceVao);
  };

  const upload = (g: WebGL2RenderingContext) => {
    if (!program || !faceProgram) return;
    if (!corners) {
      corners = g.createBuffer();
      g.bindBuffer(g.ARRAY_BUFFER, corners);
      g.bufferData(g.ARRAY_BUFFER, new Float32Array([0, -1, 1, -1, 0, 1, 1, 1]), g.STATIC_DRAW);
    }
    for (const item of arrived.splice(0)) {
      const old = tiles.get(item.key);
      if (old) release(g, old);
      const edgeBuffer = g.createBuffer()!;
      g.bindBuffer(g.ARRAY_BUFFER, edgeBuffer);
      g.bufferData(g.ARRAY_BUFFER, item.edges, g.STATIC_DRAW);
      const edgeVao = g.createVertexArray()!;
      g.bindVertexArray(edgeVao);
      const corner = g.getAttribLocation(program, "a_corner");
      const from = g.getAttribLocation(program, "a_from");
      const to = g.getAttribLocation(program, "a_to");
      g.bindBuffer(g.ARRAY_BUFFER, corners);
      g.enableVertexAttribArray(corner);
      g.vertexAttribPointer(corner, 2, g.FLOAT, false, 0, 0);
      g.bindBuffer(g.ARRAY_BUFFER, edgeBuffer);
      g.enableVertexAttribArray(from);
      g.vertexAttribPointer(from, 3, g.FLOAT, false, 24, 0);
      g.vertexAttribDivisor(from, 1);
      g.enableVertexAttribArray(to);
      g.vertexAttribPointer(to, 3, g.FLOAT, false, 24, 12);
      g.vertexAttribDivisor(to, 1);

      const faceBuffer = g.createBuffer()!;
      const faceVao = g.createVertexArray()!;
      g.bindVertexArray(faceVao);
      g.bindBuffer(g.ARRAY_BUFFER, faceBuffer);
      g.bufferData(g.ARRAY_BUFFER, item.faces, g.STATIC_DRAW);
      // Packed per vertex (see packFaces): floats, half floats, bytes.
      const attribute = (name: string, size: number, type: number, normalised: boolean, offset: number) => {
        const location = g.getAttribLocation(faceProgram!, name);
        if (location < 0) return;
        g.enableVertexAttribArray(location);
        g.vertexAttribPointer(location, size, type, normalised, PACKED_BYTES, offset);
      };
      attribute("a_pos", 3, g.FLOAT, false, 0);
      attribute("a_uv", 2, g.HALF_FLOAT, false, 12);
      attribute("a_shade", 1, g.UNSIGNED_BYTE, true, 16);
      attribute("a_kind", 1, g.UNSIGNED_BYTE, false, 17);
      attribute("a_strength", 1, g.UNSIGNED_BYTE, true, 18);
      attribute("a_colour", 1, g.UNSIGNED_BYTE, false, 19);
      g.bindVertexArray(null);
      tiles.set(item.key, {
        version: item.version,
        extent: item.extent,
        edgeCount: item.edges.length / 6,
        edgeVao,
        edgeBuffer,
        faceCount: item.faces.byteLength / PACKED_BYTES,
        faceVao,
        faceBuffer,
        usedAt: performance.now(),
      });
    }
    if (routeDirty) {
      routeDirty = false;
      if (routeDrawing) {
        g.deleteBuffer(routeDrawing.buffer);
        g.deleteVertexArray(routeDrawing.vao);
        routeDrawing = null;
      }
      if (routeData && routeData.segments.length) {
        const buffer = g.createBuffer()!;
        g.bindBuffer(g.ARRAY_BUFFER, buffer);
        g.bufferData(g.ARRAY_BUFFER, routeData.segments, g.STATIC_DRAW);
        const vao = g.createVertexArray()!;
        g.bindVertexArray(vao);
        const corner = g.getAttribLocation(program, "a_corner");
        const from = g.getAttribLocation(program, "a_from");
        const to = g.getAttribLocation(program, "a_to");
        g.bindBuffer(g.ARRAY_BUFFER, corners);
        g.enableVertexAttribArray(corner);
        g.vertexAttribPointer(corner, 2, g.FLOAT, false, 0, 0);
        g.bindBuffer(g.ARRAY_BUFFER, buffer);
        g.enableVertexAttribArray(from);
        g.vertexAttribPointer(from, 3, g.FLOAT, false, 24, 0);
        g.vertexAttribDivisor(from, 1);
        g.enableVertexAttribArray(to);
        g.vertexAttribPointer(to, 3, g.FLOAT, false, 24, 12);
        g.vertexAttribDivisor(to, 1);
        g.bindVertexArray(null);
        routeDrawing = { key: routeData.key, count: routeData.segments.length / 6, vao, buffer };
      }
    }
    // Keep the most recently drawn tiles only.
    if (tiles.size > maxTiles + 2) {
      const oldest = [...tiles.entries()].sort((a, b) => a[1].usedAt - b[1].usedAt).slice(0, tiles.size - (maxTiles + 2));
      for (const [key, tile] of oldest) {
        release(g, tile);
        tiles.delete(key);
      }
    }
  };

  const onMove = () => request();

  /** Starts on the tiles round a place the camera is about to reach (the jump's dive). */
  const prefetch = (lng: number, lat: number) => {
    const n = 2 ** TILE_ZOOM;
    const sin = Math.sin((lat * Math.PI) / 180);
    const point: [number, number] = [((lng + 180) / 360) * n, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * n];
    request(tilesToDraw({ camera: point, center: point, maxTiles }));
  };

  const layer: CustomLayerInterface & { setLook(look: SketchLook): void; setReveal(next: Reveal | null): void; setRoutes(lines: [number, number][][]): void; setPaused(next: boolean): void; prefetch(lng: number, lat: number): void; stats(): EdgeStats } = {
    id: "building-edges",
    type: "custom",
    renderingMode: "3d",
    onAdd(added, context) {
      map = added;
      gl = context as WebGL2RenderingContext;
      const compile = (type: number, source: string) => {
        const shader = gl!.createShader(type)!;
        gl!.shaderSource(shader, source);
        gl!.compileShader(shader);
        if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) throw new Error(gl!.getShaderInfoLog(shader) ?? "shader");
        return shader;
      };
      const link = (vertex: string, fragment: string) => {
        const made = gl!.createProgram()!;
        gl!.attachShader(made, compile(gl!.VERTEX_SHADER, vertex));
        gl!.attachShader(made, compile(gl!.FRAGMENT_SHADER, fragment));
        gl!.linkProgram(made);
        if (!gl!.getProgramParameter(made, gl!.LINK_STATUS)) throw new Error(gl!.getProgramInfoLog(made) ?? "link");
        return made;
      };
      program = link(VERTEX, FRAGMENT);
      faceProgram = link(FACE_VERTEX, FACE_FRAGMENT);
      for (const name of ["u_matrix", "u_viewport", "u_width", "u_wobble", "u_overshoot", "u_seed", "u_colour", "u_bias", "u_fade"]) uniforms[name] = gl.getUniformLocation(program, name);
      for (const name of ["u_matrix", "u_bias", "u_paper", "u_ink", "u_palette"]) uniforms[`face_${name}`] = gl.getUniformLocation(faceProgram, name);
      worker = new Worker(new URL("./sketch-edge-worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = receive;
      added.on("moveend", onMove);
      added.on("zoomend", onMove);
      request();
    },
    onRemove() {
      map?.off("moveend", onMove);
      map?.off("zoomend", onMove);
      worker?.terminate();
      if (gl) {
        for (const tile of tiles.values()) release(gl, tile);
        if (program) gl.deleteProgram(program);
        if (faceProgram) gl.deleteProgram(faceProgram);
        if (corners) gl.deleteBuffer(corners);
      }
      tiles.clear();
      map = null;
      gl = null;
    },
    render(context, options: CustomRenderMethodInput) {
      if (!map || !program || !faceProgram || !gl || paused) return;
      const zoom = map.getZoom();
      if (zoom < FACE_MIN_ZOOM) return;
      const g = context as WebGL2RenderingContext;
      upload(g);
      const ratio = window.devicePixelRatio || 1;
      const now = performance.now();
      const visible = new Set(want().map(({ x, y }) => tileKey(x, y)));
      const matrixFor = (key: string, extent: number) => {
        const [z, x, y] = key.split("/").map(Number);
        const n = 2 ** z;
        const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n))) * 180) / Math.PI;
        const metre = 1 / (40075016.686 * Math.cos((lat * Math.PI) / 180));
        const unit = 1 / (n * extent);
        const model = [unit, 0, 0, 0, 0, unit, 0, 0, 0, 0, metre, 0, x / n, y / n, 0, 1];
        return new Float32Array(multiply(options.defaultProjectionData.mainMatrix as unknown as ArrayLike<number>, model));
      };
      g.enable(g.DEPTH_TEST);
      g.depthFunc(g.LEQUAL);

      // Our buildings: paper forms with drawn facades, writing depth so they
      // hide one another and MapLibre's boxes inside them.
      g.useProgram(faceProgram);
      g.disable(g.BLEND);
      g.depthMask(true);
      g.uniform1f(uniforms.face_u_bias, edgeBias() * 0.5);
      g.uniform3f(uniforms.face_u_paper, ...stroke.paper);
      g.uniform3f(uniforms.face_u_ink, ...stroke.colour);
      g.uniform3fv(uniforms.face_u_palette, PALETTE);
      for (const [key, tile] of tiles) {
        if (!visible.has(key) || tile.faceCount === 0) continue;
        g.uniformMatrix4fv(uniforms.face_u_matrix, false, matrixFor(key, tile.extent));
        g.bindVertexArray(tile.faceVao);
        g.drawArrays(g.TRIANGLES, 0, tile.faceCount);
      }

      const fade = Math.min(1, Math.max(0, (zoom - EDGE_MIN_ZOOM + 0.4) / 0.5));
      g.useProgram(program);
      g.depthMask(false);
      g.uniform2f(uniforms.u_viewport, g.drawingBufferWidth, g.drawingBufferHeight);
      g.enable(g.BLEND);
      g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA);
      // How far the middle of the view is: edges fade from twice that to four times.
      const main = options.defaultProjectionData.mainMatrix as unknown as ArrayLike<number>;
      const center = map.getCenter();
      const sin = Math.sin((center.lat * Math.PI) / 180);
      const mx = (center.lng + 180) / 360;
      const my = 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
      const centerW = main[3] * mx + main[7] * my + main[15];
      g.uniform2f(uniforms.u_fade, centerW * 1.8, centerW * 3.6);
      const passes = stroke.second > 0 ? [{ seed: 0, alpha: 1 }, { seed: 7.31, alpha: stroke.second }] : [{ seed: 0, alpha: 1 }];
      for (const [key, tile] of tiles) {
        if (!visible.has(key)) continue;
        tile.usedAt = now;
        g.uniformMatrix4fv(uniforms.u_matrix, false, matrixFor(key, tile.extent));
        g.bindVertexArray(tile.edgeVao);
        for (const pass of passes) {
          g.uniform1f(uniforms.u_width, stroke.width * ratio);
          g.uniform1f(uniforms.u_wobble, stroke.wobble * ratio);
          g.uniform1f(uniforms.u_overshoot, stroke.overshoot * ratio);
          g.uniform1f(uniforms.u_seed, pass.seed);
          g.uniform1f(uniforms.u_bias, edgeBias());
          g.uniform4f(uniforms.u_colour, ...stroke.colour, pass.alpha * fade);
          g.drawArraysInstanced(g.TRIANGLE_STRIP, 0, 4, tile.edgeCount);
        }
      }
      // Her route on the ground: the one red line, hidden where a building stands in front.
      if (routeDrawing) {
        const routeFade = Math.min(1, Math.max(0, (zoom - FACE_MIN_ZOOM) / 0.9));
        g.uniformMatrix4fv(uniforms.u_matrix, false, matrixFor(routeDrawing.key, 4096));
        g.uniform2f(uniforms.u_fade, 1e9, 2e9);
        g.uniform1f(uniforms.u_width, ROUTE_WIDTH_PX * ratio);
        g.uniform1f(uniforms.u_wobble, 0);
        g.uniform1f(uniforms.u_overshoot, 0);
        g.uniform1f(uniforms.u_seed, 0);
        g.uniform4f(uniforms.u_colour, ...ROUTE_RED, 0.92 * routeFade);
        g.bindVertexArray(routeDrawing.vao);
        g.drawArraysInstanced(g.TRIANGLE_STRIP, 0, 4, routeDrawing.count);
      }
      g.bindVertexArray(null);
    },
    /** Her routes, at full resolution once loaded, to draw on the ground close up. */
    setRoutes(lines: [number, number][][]) {
      routeData = routeOnGround(lines, TILE_ZOOM, 4096);
      routeDirty = true;
      map?.triggerRepaint();
    },
    setLook(next) {
      stroke = STROKE[next];
      map?.triggerRepaint();
    },
    prefetch,
    setPaused(next: boolean) {
      paused = next;
      map?.triggerRepaint();
    },
    /** A new reveal: every tile near the camera is made again for it. */
    setReveal(next) {
      version += 1;
      reveal = next && next.radiusM > 0 && next.lines.length > 0 ? { ...next, version } : null;
      exploredCount = 0;
      request();
    },
    stats() {
      let segments = 0;
      let faces = 0;
      for (const tile of tiles.values()) {
        segments += tile.edgeCount;
        faces += tile.faceCount / 3;
      }
      return { tiles: tiles.size, segments, triangles: faces, pending: pending.size, explored: exploredCount, revealedTiles: tiles.size };
    },
  };
  return layer;
}
