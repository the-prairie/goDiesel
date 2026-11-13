// The buildings' drawn edges: a MapLibre custom layer that draws each
// building's roof outline, base and corners as anti-aliased lines of a fixed
// width on screen, depth-tested against MapLibre's own white extrusions so
// hidden edges stay hidden. The lines are geometry, so they hold steady as
// the camera moves; a line too short to read on screen fades out rather
// than shimmering. The pencil look shifts each end of a stroke a little,
// lets it overshoot its corner and draws a second, fainter stroke.

import type { CustomLayerInterface, CustomRenderMethodInput, Map as MapLibreMap } from "maplibre-gl";

import type { EdgeRequest, EdgeResponse } from "@/labs/sketch/sketch-edge-worker";
import type { ExploredId } from "@/labs/sketch/sketch-tile";
import type { SketchLook } from "@/labs/sketch/sketch-options";

/** Building tiles are made at zoom 14 and drawn larger from there. */
const TILE_ZOOM = 14;
/** Edges start to draw here and are fully in by the next half level. */
const EDGE_MIN_ZOOM = 15;
/** Explored buildings come into colour as the white forms stand up. */
const FACE_MIN_ZOOM = 14.6;
/** Tiles are read from here in, for the colour reveal and the edges to come. */
const TILE_MIN_ZOOM = 14;

const STROKE: Record<SketchLook, { colour: [number, number, number]; width: number; wobble: number; overshoot: number; second: number }> = {
  line: { colour: [0.11, 0.11, 0.12], width: 1.15, wobble: 0, overshoot: 0, second: 0 },
  pencil: { colour: [0.27, 0.26, 0.24], width: 1.05, wobble: 1.3, overshoot: 3, second: 0.42 },
};

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
in vec3 a_colour;
in float a_strength;
uniform mat4 u_matrix;
uniform float u_bias;
out vec3 v_colour;
void main() {
  vec4 c = u_matrix * vec4(a_pos, 1.0);
  float ndc = c.z / c.w;
  gl_Position = vec4(c.xy, (ndc - u_bias * (1.0 - ndc)) * c.w, c.w);
  // Half revealed is half way back to the sketch's white.
  v_colour = mix(vec3(1.0), a_colour, a_strength);
}`;

const FACE_FRAGMENT = `#version 300 es
precision highp float;
in vec3 v_colour;
out vec4 fragColor;
void main() {
  fragColor = vec4(v_colour, 1.0);
}`;

interface TileFaces {
  version: number;
  count: number;
  vao: WebGLVertexArrayObject;
  buffer: WebGLBuffer;
}

interface TileEdges {
  z: number;
  x: number;
  y: number;
  extent: number;
  count: number;
  vao: WebGLVertexArrayObject;
  buffer: WebGLBuffer;
  usedAt: number;
}

export interface EdgeStats {
  tiles: number;
  segments: number;
  pending: number;
  explored: number;
  revealedTiles: number;
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
  /** Features near her routes, found in a tile, for the map to colour. */
  onExplored: (ids: ExploredId[]) => void;
}) {
  let reveal: (Reveal & { version: number; box: [number, number, number, number] }) | null = null;
  // The reveal version each tile was last read for.
  const revealed = new Map<string, number>();
  let exploredCount = 0;
  let map: MapLibreMap | null = null;
  let gl: WebGL2RenderingContext | null = null;
  let program: WebGLProgram | null = null;
  let corners: WebGLBuffer | null = null;
  let worker: Worker | null = null;
  let stroke = STROKE[look];
  const tiles = new Map<string, TileEdges>();
  // Tiles read by the worker, waiting to be uploaded inside `render`, where
  // MapLibre expects GL state to change and restores its own afterwards.
  const arrived: { key: string; edges: Float32Array; extent: number }[] = [];
  const arrivedFaces: { key: string; faces: Float32Array; version: number }[] = [];
  const faces = new Map<string, TileFaces>();
  let faceProgram: WebGLProgram | null = null;
  const pending = new Set<string>();
  const failed = new Set<string>();
  const uniforms: Record<string, WebGLUniformLocation | null> = {};

  const want = () => {
    if (!map || !worker || map.getZoom() < TILE_MIN_ZOOM) return [];
    const n = 2 ** TILE_ZOOM;
    const center = map.getCenter();
    const cx = ((center.lng + 180) / 360) * n;
    const s = Math.sin((center.lat * Math.PI) / 180);
    const cy = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
    // Tiles near the middle of the view first; looking far ahead adds the
    // tiles the camera faces.
    const bearing = (map.getBearing() * Math.PI) / 180;
    const ahead = map.getPitch() > 45 ? 1.2 : 0;
    const fx = cx + Math.sin(bearing) * ahead;
    const fy = cy - Math.cos(bearing) * ahead;
    const candidates: { x: number; y: number; d: number }[] = [];
    for (let dy = -2; dy <= 2; dy += 1)
      for (let dx = -2; dx <= 2; dx += 1) {
        const x = Math.floor(fx) + dx;
        const y = Math.floor(fy) + dy;
        candidates.push({ x, y, d: Math.hypot(x + 0.5 - fx, y + 0.5 - fy) });
      }
    return candidates.sort((a, b) => a.d - b.d).slice(0, maxTiles);
  };

  /** Whether a tile lies within the reveal's reach of her routes. */
  const nearRoutes = (x: number, y: number) => {
    if (!reveal) return false;
    const n = 2 ** TILE_ZOOM;
    const west = (x / n) * 360 - 180;
    const east = ((x + 1) / n) * 360 - 180;
    const lat = (row: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * row) / n))) * 180) / Math.PI;
    const [w, s, e, nn] = reveal.box;
    return east >= w && west <= e && lat(y) >= s && lat(y + 1) <= nn;
  };

  const request = () => {
    for (const { x, y } of want()) {
      const key = tileKey(x, y);
      if (pending.has(key) || failed.has(key)) continue;
      const needsEdges = !tiles.has(key) && !arrived.some((item) => item.key === key);
      const needsReveal = reveal !== null && revealed.get(key) !== reveal.version && nearRoutes(x, y);
      if (!needsEdges && !needsReveal) continue;
      pending.add(key);
      const url = tilesUrl.replace("{z}", String(TILE_ZOOM)).replace("{x}", String(x)).replace("{y}", String(y));
      worker!.postMessage({
        key,
        url,
        edges: needsEdges,
        reveal: needsReveal && reveal ? { lines: reveal.lines, radiusM: reveal.radiusM, fade: reveal.fade, version: reveal.version } : null,
      } satisfies EdgeRequest);
    }
  };

  const receive = (event: MessageEvent<EdgeResponse>) => {
    const message = event.data;
    pending.delete(message.key);
    if ("error" in message) {
      failed.add(message.key);
      return;
    }
    if (message.edges) arrived.push({ key: message.key, edges: message.edges, extent: message.extent });
    if (message.explored && reveal && message.version === reveal.version) {
      revealed.set(message.key, message.version);
      exploredCount += message.explored.length;
      onExplored(message.explored);
      if (message.faces) arrivedFaces.push({ key: message.key, faces: message.faces, version: message.version });
    }
    map?.triggerRepaint();
    // Something may have been wanted while this tile was on its way.
    request();
  };

  const upload = (g: WebGL2RenderingContext) => {
    if (!program) return;
    if (!corners) {
      corners = g.createBuffer();
      g.bindBuffer(g.ARRAY_BUFFER, corners);
      g.bufferData(g.ARRAY_BUFFER, new Float32Array([0, -1, 1, -1, 0, 1, 1, 1]), g.STATIC_DRAW);
    }
    for (const { key, edges, extent } of arrived.splice(0)) {
      const [, x, y] = key.split("/").map(Number);
      const buffer = g.createBuffer()!;
      g.bindBuffer(g.ARRAY_BUFFER, buffer);
      g.bufferData(g.ARRAY_BUFFER, edges, g.STATIC_DRAW);
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
      tiles.set(key, { z: TILE_ZOOM, x, y, extent, count: edges.length / 6, vao, buffer, usedAt: performance.now() });
    }
    for (const { key, faces: data, version } of arrivedFaces.splice(0)) {
      if (!faceProgram || version !== reveal?.version) continue;
      const old = faces.get(key);
      if (old) {
        g.deleteBuffer(old.buffer);
        g.deleteVertexArray(old.vao);
      }
      const buffer = g.createBuffer()!;
      g.bindBuffer(g.ARRAY_BUFFER, buffer);
      g.bufferData(g.ARRAY_BUFFER, data, g.STATIC_DRAW);
      const vao = g.createVertexArray()!;
      g.bindVertexArray(vao);
      const attribute = (name: string, size: number, offset: number) => {
        const location = g.getAttribLocation(faceProgram!, name);
        g.enableVertexAttribArray(location);
        g.vertexAttribPointer(location, size, g.FLOAT, false, 28, offset);
      };
      attribute("a_pos", 3, 0);
      attribute("a_colour", 3, 12);
      attribute("a_strength", 1, 24);
      g.bindVertexArray(null);
      faces.set(key, { version, count: data.length / 7, vao, buffer });
    }
    // Faces from an earlier reveal go.
    for (const [key, face] of faces) {
      if (face.version === reveal?.version) continue;
      g.deleteBuffer(face.buffer);
      g.deleteVertexArray(face.vao);
      faces.delete(key);
    }
    // Keep the most recently drawn tiles only.
    if (tiles.size > maxTiles * 2) {
      const oldest = [...tiles.entries()].sort((a, b) => a[1].usedAt - b[1].usedAt).slice(0, tiles.size - maxTiles * 2);
      for (const [key, tile] of oldest) {
        g.deleteBuffer(tile.buffer);
        g.deleteVertexArray(tile.vao);
        tiles.delete(key);
      }
    }
  };

  const onMove = () => request();

  const layer: CustomLayerInterface & { setLook(look: SketchLook): void; setReveal(next: Reveal | null): void; stats(): EdgeStats } = {
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
      program = gl.createProgram()!;
      gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "link");
      faceProgram = gl.createProgram()!;
      gl.attachShader(faceProgram, compile(gl.VERTEX_SHADER, FACE_VERTEX));
      gl.attachShader(faceProgram, compile(gl.FRAGMENT_SHADER, FACE_FRAGMENT));
      gl.linkProgram(faceProgram);
      if (!gl.getProgramParameter(faceProgram, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(faceProgram) ?? "link");
      for (const name of ["u_matrix", "u_bias"]) uniforms[`face_${name}`] = gl.getUniformLocation(faceProgram, name);
      for (const name of ["u_matrix", "u_viewport", "u_width", "u_wobble", "u_overshoot", "u_seed", "u_colour", "u_bias", "u_fade"]) uniforms[name] = gl.getUniformLocation(program, name);
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
        for (const tile of tiles.values()) {
          gl.deleteBuffer(tile.buffer);
          gl.deleteVertexArray(tile.vao);
        }
        if (program) gl.deleteProgram(program);
        if (corners) gl.deleteBuffer(corners);
      }
      tiles.clear();
      map = null;
      gl = null;
    },
    render(context, options: CustomRenderMethodInput) {
      if (!map || !program || !gl) return;
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
      g.depthMask(false);

      // The explored buildings in colour, over MapLibre's white forms.
      if (faceProgram && faces.size) {
        g.useProgram(faceProgram);
        g.disable(g.BLEND);
        g.uniform1f(uniforms.face_u_bias, edgeBias() * 0.5);
        for (const [key, face] of faces) {
          if (!visible.has(key)) continue;
          g.uniformMatrix4fv(uniforms.face_u_matrix, false, matrixFor(key, 4096));
          g.bindVertexArray(face.vao);
          g.drawArrays(g.TRIANGLES, 0, face.count);
        }
      }

      if (zoom >= EDGE_MIN_ZOOM) {
        const fade = Math.min(1, (zoom - EDGE_MIN_ZOOM) / 0.5);
        g.useProgram(program);
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
          g.bindVertexArray(tile.vao);
          for (const pass of passes) {
            g.uniform1f(uniforms.u_width, stroke.width * ratio);
            g.uniform1f(uniforms.u_wobble, stroke.wobble * ratio);
            g.uniform1f(uniforms.u_overshoot, stroke.overshoot * ratio);
            g.uniform1f(uniforms.u_seed, pass.seed);
            g.uniform1f(uniforms.u_bias, edgeBias());
            g.uniform4f(uniforms.u_colour, ...stroke.colour, pass.alpha * fade);
            g.drawArraysInstanced(g.TRIANGLE_STRIP, 0, 4, tile.count);
          }
        }
      }
      g.bindVertexArray(null);
    },
    setLook(next) {
      stroke = STROKE[next];
      map?.triggerRepaint();
    },
    /** A new reveal: every tile is read again for it; the caller clears the old colour. */
    setReveal(next) {
      const version = (reveal?.version ?? 0) + 1;
      if (!next || next.radiusM <= 0 || next.lines.length === 0) reveal = null;
      else {
        // The routes' box, grown by the radius (a degree of latitude is 111 km).
        const pad = next.radiusM / 111_000 / Math.cos((next.lines[0][0][1] * Math.PI) / 180);
        const points = next.lines.flat();
        reveal = {
          ...next,
          version,
          box: [
            Math.min(...points.map((p) => p[0])) - pad,
            Math.min(...points.map((p) => p[1])) - pad,
            Math.max(...points.map((p) => p[0])) + pad,
            Math.max(...points.map((p) => p[1])) + pad,
          ],
        };
      }
      revealed.clear();
      exploredCount = 0;
      request();
    },
    stats() {
      let segments = 0;
      for (const tile of tiles.values()) segments += tile.count;
      return { tiles: tiles.size, segments, pending: pending.size, explored: exploredCount, revealedTiles: revealed.size };
    },
  };
  return layer;
}
