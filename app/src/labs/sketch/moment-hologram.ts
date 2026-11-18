import type { CustomLayerInterface, CustomRenderMethodInput, Map as MapLibreMap } from "maplibre-gl";

import type { MomentKind, Placement } from "@/labs/sketch/moment-catalog";
import { HIT_PT, inView, markerShape, motionAt, onRoof, zoomBlend } from "@/labs/sketch/moment-hologram-math";

// The planted moment's marker, drawn in the world as a real 3D thing: from
// city zoom a column of light from the roof (cyan at the base, through pink,
// to nothing) with a ring pulsing on the roof and a pool of coloured light;
// at street zoom a see-through television floating just above the roof,
// turning and bobbing over a short projection cone. One WebGL layer after
// the drawn buildings, so a taller building in front hides it. It asks for
// frames only while a marker is on screen and motion is allowed.

type V3 = [number, number, number];
type RGB = [number, number, number];

const CYAN: RGB = [0.1, 0.78, 0.94];
const MAGENTA: RGB = [1, 0.31, 0.76];
const LIME: RGB = [0.61, 0.89, 0.42];
/** Floats a vertex: position, uv, part, colour and alpha. */
const STRIDE = 10;
const PART = { beam: 0, pool: 1, ring: 2, face: 3, front: 4, cone: 5, back: 6, rod: 7 } as const;

/** Each kind's object up close: its faces (the screen is the front). The beam, ring and pool are every kind's. */
const OBJECTS: Record<MomentKind, { sides: RGB[] }> = {
  "tv-wall": { sides: [CYAN, MAGENTA, LIME, CYAN, MAGENTA] },
};

const VERTEX = `#version 300 es
uniform mat4 u_matrix;
in vec3 a_pos;
in vec2 a_uv;
in float a_part;
in vec4 a_colour;
out vec2 v_uv;
out float v_part;
out vec4 v_colour;
void main() {
  v_uv = a_uv;
  v_part = a_part;
  v_colour = a_colour;
  gl_Position = u_matrix * vec4(a_pos, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform float u_pulse;
uniform float u_scan;
/** Which winding faces the viewer, as MapLibre's projection leaves it. */
uniform bool u_flip;
in vec2 v_uv;
in float v_part;
in vec4 v_colour;
out vec4 colour;
const vec3 CYAN = vec3(0.1, 0.78, 0.94);
const vec3 PINK = vec3(1.0, 0.31, 0.76);
void main() {
  vec3 c = v_colour.rgb;
  float a = v_colour.a;
  int part = int(v_part + 0.5);
  if (part == 0) {
    // The beam: cyan at the roof, through pink, to nothing; brightest at its core.
    c = mix(CYAN, PINK, smoothstep(0.0, 0.6, v_uv.y));
    a *= pow(1.0 - v_uv.y, 1.4) * (1.0 - v_uv.x * v_uv.x) * 0.95;
  } else if (part == 1) {
    float r = length(v_uv);
    c = mix(CYAN, PINK, smoothstep(0.1, 0.8, r));
    a *= smoothstep(1.0, 0.0, r) * (0.85 + 0.12 * sin(u_pulse * 6.2832)) + smoothstep(0.45, 0.0, r) * 0.25;
  } else if (part == 2) {
    float r = length(v_uv);
    float at = mix(0.25, 1.0, u_pulse);
    c = CYAN;
    a *= (1.0 - u_pulse) * smoothstep(0.09, 0.0, abs(r - at));
  } else if (part == 5) {
    c = CYAN;
    a *= mix(0.6, 0.06, v_uv.y);
  } else if (part == 7) {
    // A rabbit-ear rod.
    c = vec3(0.0, 0.5, 0.72);
    a *= 0.95;
  } else {
    // The set: its front has a bezel, a rounded screen of colour bars and two
    // knobs; the back shows the bars through it, mirrored and dim; its other
    // faces are faint, with an inset outline and moving scanlines.
    // The screen is on the front face alone; seen from behind, through the set,
    // it reads mirrored (as it would) and dimmer.
    vec2 uv = v_uv;
    bool front = part == 4;
    bool behind = front && gl_FrontFacing == u_flip;
    a *= front && !behind ? 0.55 : 0.26;
    float scan = step(0.5, fract((uv.y + u_scan) * 12.0));
    c = mix(c, vec3(1.0), 0.22 * scan);
    if (front) {
      // The screen, with rounded corners (the face is 42 by 32).
      vec2 p = (uv - vec2(0.385, 0.5)) * vec2(1.3125, 1.0);
      vec2 q = abs(p) - vec2(0.41 - 0.07, 0.38 - 0.07);
      float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.07;
      if (d < 0.0) {
        int bar = int(clamp((uv.x - 0.07) / 0.63, 0.0, 0.999) * 7.0);
        vec3 bars[7] = vec3[7](vec3(0.96), vec3(0.97, 0.9, 0.2), vec3(0.15, 0.88, 0.92), vec3(0.25, 0.85, 0.3), vec3(0.92, 0.3, 0.85), vec3(0.95, 0.22, 0.2), vec3(0.2, 0.36, 0.95));
        c = mix(bars[bar], vec3(1.0), 0.12 * scan);
        a = v_colour.a * (behind ? 0.45 : 0.96);
      }
      float bezel = smoothstep(0.018, 0.0, abs(d));
      c = mix(c, vec3(0.0, 0.42, 0.62), bezel);
      a = max(a, v_colour.a * 0.9 * bezel);
      // Two knobs beside the screen.
      for (int k = 0; k < 2; k++) {
        float r = length((uv - vec2(0.86, k == 0 ? 0.64 : 0.38)) * vec2(1.3125, 1.0));
        float knob = smoothstep(0.075, 0.06, r);
        c = mix(c, vec3(0.0, 0.42, 0.62), knob);
        a = max(a, v_colour.a * knob * (behind ? 0.4 : 0.95));
      }
    }
    float edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    float line = smoothstep(0.04, 0.015, edge);
    c = mix(c, vec3(0.0, 0.5, 0.72), line);
    a = mix(a, v_colour.a * 0.95, line);
  }
  colour = vec4(c * a, a);
}`;

/** One placed marker's world: where it stands and what it is. */
export interface HologramMarker {
  placement: Placement;
  kind: MomentKind;
  /** Moved to the screen point she should tap (the 44 pt hit area's centre). */
  button: HTMLElement;
}

interface Placed extends HologramMarker {
  lng: number;
  lat: number;
  roof: number | null;
  poolMaxM: number;
}

type Roof = { top: number; west: number; east: number; south: number; north: number };

/** Set once by eye: whether the front face's outside is the back-facing side after projection. */
const FLIP = false;
/** Until the drawn roof is known. */
const UNKNOWN_ROOF_M = 8;

function multiply(a: ArrayLike<number>, b: ArrayLike<number>) {
  const out = new Float64Array(16);
  for (let c = 0; c < 4; c += 1) for (let r = 0; r < 4; r += 1) out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return out;
}

export function hologramLayer(markers: HologramMarker[], options: { reducedMotion: boolean; roofUnder: (lng: number, lat: number) => Roof | null }) {
  const placed: Placed[] = markers.map((marker) => {
    const { at, facingDeg } = marker.placement;
    return { ...marker, ...onRoof(at, facingDeg, null), roof: null };
  });
  /** Once its tile is made, the marker moves to the middle of the roof that is drawn. */
  const settle = (marker: Placed) => {
    const { at, facingDeg } = marker.placement;
    const probe = onRoof(at, facingDeg, null);
    const roof = options.roofUnder((at.lng + probe.lng) / 2, (at.lat + probe.lat) / 2);
    if (!roof) return;
    Object.assign(marker, onRoof(at, facingDeg, roof), { roof: roof.top });
  };
  let map: MapLibreMap | null = null;
  let gl: WebGL2RenderingContext | null = null;
  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  let vao: WebGLVertexArrayObject | null = null;
  const uniforms: Record<string, WebGLUniformLocation | null> = {};

  const layer: CustomLayerInterface = {
    id: "moment-holograms",
    type: "custom",
    renderingMode: "3d",
    onAdd(added, context) {
      map = added;
      const g = (gl = context as WebGL2RenderingContext);
      const shader = (type: number, source: string) => {
        const made = g.createShader(type)!;
        g.shaderSource(made, source);
        g.compileShader(made);
        if (!g.getShaderParameter(made, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(made) ?? "shader");
        return made;
      };
      program = g.createProgram()!;
      g.attachShader(program, shader(g.VERTEX_SHADER, VERTEX));
      g.attachShader(program, shader(g.FRAGMENT_SHADER, FRAGMENT));
      g.linkProgram(program);
      if (!g.getProgramParameter(program, g.LINK_STATUS)) throw new Error(g.getProgramInfoLog(program) ?? "link");
      for (const name of ["u_matrix", "u_pulse", "u_scan", "u_flip"]) uniforms[name] = g.getUniformLocation(program, name);
      buffer = g.createBuffer();
      vao = g.createVertexArray();
      g.bindVertexArray(vao);
      g.bindBuffer(g.ARRAY_BUFFER, buffer);
      const attribute = (name: string, size: number, offset: number) => {
        const location = g.getAttribLocation(program!, name);
        g.enableVertexAttribArray(location);
        g.vertexAttribPointer(location, size, g.FLOAT, false, STRIDE * 4, offset * 4);
      };
      attribute("a_pos", 3, 0);
      attribute("a_uv", 2, 3);
      attribute("a_part", 1, 5);
      attribute("a_colour", 4, 6);
      g.bindVertexArray(null);
    },
    onRemove() {
      if (gl) {
        if (program) gl.deleteProgram(program);
        if (buffer) gl.deleteBuffer(buffer);
        if (vao) gl.deleteVertexArray(vao);
      }
      map = null;
      gl = null;
    },
    render(context, input: CustomRenderMethodInput) {
      if (!map || !program || !vao) return;
      const g = context as WebGL2RenderingContext;
      const zoom = map.getZoom();
      const shown = zoom >= 10;
      for (const marker of placed) marker.button.hidden = !shown;
      if (!shown || !placed.length) return;
      const t = zoomBlend(zoom);
      const motion = motionAt(performance.now(), options.reducedMotion);
      const bearing = (map.getBearing() * Math.PI) / 180;
      const right: [number, number] = [Math.cos(bearing), -Math.sin(bearing)];
      const canvas = map.getCanvas();
      const viewport = { width: canvas.clientWidth, height: canvas.clientHeight };
      const main = input.defaultProjectionData.mainMatrix as unknown as ArrayLike<number>;
      g.useProgram(program);
      g.uniform1f(uniforms.u_pulse, motion.pulse);
      g.uniform1f(uniforms.u_scan, motion.scan);
      g.uniform1i(uniforms.u_flip, FLIP ? 1 : 0);
      g.enable(g.DEPTH_TEST);
      g.depthFunc(g.LEQUAL);
      g.depthMask(false);
      g.enable(g.BLEND);
      g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA);
      g.bindVertexArray(vao);
      g.bindBuffer(g.ARRAY_BUFFER, buffer);
      let anyInView = false;
      for (const marker of placed) {
        if (marker.roof === null) settle(marker);
        const roof = marker.roof ?? UNKNOWN_ROOF_M;
        const metre = 1 / (40075016.686 * Math.cos((marker.lat * Math.PI) / 180));
        const s = Math.sin((marker.lat * Math.PI) / 180);
        const mx = (marker.lng + 180) / 360;
        const my = 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
        // Local metres (east, north, up from the ground) to the map's clip space.
        const matrix = multiply(main, [metre, 0, 0, 0, 0, -metre, 0, 0, 0, 0, metre, 0, mx, my, 0, 1]);
        const metresPerPixel = 40075016.686 * Math.cos((marker.lat * Math.PI) / 180) / (512 * 2 ** zoom);
        const shape = markerShape(t, metresPerPixel);
        // Up close the pool and ring stay on the roof.
        shape.poolM = shape.poolM * (1 - t) + Math.min(shape.poolM, marker.poolMaxM) * t;
        shape.ringM = shape.ringM * (1 - t) + Math.min(shape.ringM, marker.poolMaxM) * t;
        const data = geometry(shape, motion, roof, right, OBJECTS[marker.kind]);
        g.uniformMatrix4fv(uniforms.u_matrix, false, new Float32Array(matrix));
        g.bufferData(g.ARRAY_BUFFER, data, g.STREAM_DRAW);
        g.drawArrays(g.TRIANGLES, 0, data.length / STRIDE);
        // Her tap lands on what she sees: low on the beam from far, the television up close.
        const tv = shape.tv;
        const hit = project(matrix, [0, 0, roof + (1 - t) * 22 * metresPerPixel + t * (tv.liftM + tv.h / 2)], viewport);
        const top = project(matrix, [0, 0, roof + shape.beamLengthM], viewport);
        marker.button.style.transform = hit ? `translate(${hit.x - HIT_PT / 2}px, ${hit.y - HIT_PT / 2}px)` : "translate(-999px, -999px)";
        if (inView([hit, top].filter((p): p is { x: number; y: number } => p !== null), viewport)) anyInView = true;
      }
      g.bindVertexArray(null);
      g.disable(g.BLEND);
      if (anyInView && !options.reducedMotion) map.triggerRepaint();
    },
  };
  return layer;
}

function project(matrix: ArrayLike<number>, [x, y, z]: V3, viewport: { width: number; height: number }) {
  const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
  if (w <= 0) return null;
  const cx = (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / w;
  const cy = (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / w;
  return { x: ((cx + 1) / 2) * viewport.width, y: ((1 - cy) / 2) * viewport.height };
}

/** The marker's triangles this frame, in local metres. */
function geometry(shape: ReturnType<typeof markerShape>, motion: ReturnType<typeof motionAt>, roof: number, right: [number, number], object: { sides: RGB[] }) {
  const out: number[] = [];
  const vertex = (p: V3, u: number, v: number, part: number, rgb: RGB, alpha: number) => out.push(p[0], p[1], p[2], u, v, part, rgb[0], rgb[1], rgb[2], alpha);
  const quad = (a: V3, b: V3, c: V3, d: V3, uv: [number, number][], part: number, rgb: RGB, alpha: number) => {
    // a b c d around the quad; uv in the same order.
    for (const i of [0, 1, 2, 0, 2, 3]) vertex([a, b, c, d][i], uv[i][0], uv[i][1], part, rgb, alpha);
  };
  const lift = 0.15;
  // The pool and the ring, flat on the roof.
  for (const [part, r] of [[PART.pool, shape.poolM], [PART.ring, shape.ringM]] as const) {
    quad([-r, -r, roof + lift], [r, -r, roof + lift], [r, r, roof + lift], [-r, r, roof + lift], [[-1, -1], [1, -1], [1, 1], [-1, 1]], part, CYAN, 1);
  }
  // The beam, turned to face her.
  if (shape.beamLengthM > 0) {
    const w = shape.beamWidthM / 2;
    const [rx, ry] = [right[0] * w, right[1] * w];
    const top = roof + shape.beamLengthM;
    quad([-rx, -ry, roof], [rx, ry, roof], [rx, ry, top], [-rx, -ry, top], [[-1, 0], [1, 0], [1, 1], [-1, 1]], PART.beam, CYAN, 1);
  }
  if (shape.tvScale <= 0) return new Float32Array(out);
  const tv = shape.tv;
  const k = shape.tvScale;
  const [hw, hd, h] = [(tv.w / 2) * k, (tv.d / 2) * k, tv.h * k];
  const base = roof + tv.liftM * k + motion.bobM;
  // The projection cone, from under the television to the roof.
  {
    // Its foot meets the pool of light.
    const w = shape.poolM * 0.9;
    const [rx, ry] = [right[0] * w, right[1] * w];
    for (const i of [0, 1, 2]) vertex([[0, 0, base], [-rx, -ry, roof + lift], [rx, ry, roof + lift]][i] as V3, 0.5, i === 0 ? 0 : 1, PART.cone, CYAN, shape.tvAlpha);
  }
  // The set, turning slowly: its front (with the screen) faces -y before it turns.
  const cos = Math.cos(motion.spin);
  const sin = Math.sin(motion.spin);
  const at = (x: number, y: number, z: number): V3 => [x * cos - y * sin, x * sin + y * cos, base + z];
  const corners = [at(-hw, -hd, 0), at(hw, -hd, 0), at(hw, hd, 0), at(-hw, hd, 0), at(-hw, -hd, h), at(hw, -hd, h), at(hw, hd, h), at(-hw, hd, h)];
  const uv: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const face = (ids: number[], part: number, rgb: RGB) => quad(corners[ids[0]], corners[ids[1]], corners[ids[2]], corners[ids[3]], uv, part, rgb, shape.tvAlpha);
  face([0, 1, 5, 4], PART.front, MAGENTA);
  face([2, 3, 7, 6], PART.back, MAGENTA);
  [[1, 2, 6, 5], [3, 0, 4, 7], [4, 5, 6, 7], [3, 2, 1, 0]].forEach((ids, i) => face(ids, PART.face, object.sides[i % object.sides.length]));
  // Rabbit ears: two rods in a V from the top, each two crossed strips so they read from any side.
  const r = hw * 0.03;
  for (const side of [-1, 1]) {
    const [bx, bz] = [side * hw * 0.12, h];
    const [tx, tz] = [side * hw * 0.62, h * 1.75];
    const len = Math.hypot(tx - bx, tz - bz);
    const [nx, nz] = [((tz - bz) / len) * r, (-(tx - bx) / len) * r];
    quad(at(bx - nx, 0, bz - nz), at(bx + nx, 0, bz + nz), at(tx + nx, 0, tz + nz), at(tx - nx, 0, tz - nz), uv, PART.rod, CYAN, shape.tvAlpha);
    quad(at(bx, -r, bz), at(bx, r, bz), at(tx, r, tz), at(tx, -r, tz), uv, PART.rod, CYAN, shape.tvAlpha);
  }
  return new Float32Array(out);
}
