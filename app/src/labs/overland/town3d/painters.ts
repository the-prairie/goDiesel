// The town's pixel art, painted into canvases: the ground, the houses'
// facades and roofs, the tree crowns, the water, the signs. Everything is
// drawn in code at 16 texels to a world unit, from the plan and its kit.
// The four Japanese houses are the approved prototype's painters.

import { context2d, makeCanvas } from "@/labs/overland/engine/canvas";
import { C } from "@/labs/overland/engine/palette";
import { drawText } from "@/labs/overland/engine/text-draw";
import { measureText } from "@/labs/overland/engine/font";
import { HOUSE_SPECS, type DoorStyle, type HouseSpec, type RoofStyle, type TreeSpecies, type WallStyle, type WindowStyle } from "@/labs/overland/model/town-kits";
import { cellHash as h2, pathDistance, valueNoise as vn, type House, type TownPlan } from "@/labs/overland/model/town-plan";

export interface Pair {
  m: HTMLCanvasElement;
  e: HTMLCanvasElement;
}

type Weights = Array<[string, number]>;

export class Painter {
  readonly c: HTMLCanvasElement;
  readonly x: CanvasRenderingContext2D;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.c = makeCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
    this.x = context2d(this.c);
  }
  r(X: number, Y: number, W: number, H: number, col: string) {
    this.x.fillStyle = col;
    this.x.fillRect(X, Y, W, H);
    return this;
  }
  p(X: number, Y: number, col: string) {
    this.x.fillStyle = col;
    this.x.fillRect(X, Y, 1, 1);
    return this;
  }
  n(X: number, Y: number, W: number, H: number, cols: Weights, s: number) {
    for (let j = Y; j < Y + H; j += 1) {
      for (let i = X; i < X + W; i += 1) {
        const r = h2(i, j, s);
        let a = 0;
        for (let k = 0; k < cols.length; k += 1) {
          a += cols[k][1];
          if (r < a || k === cols.length - 1) {
            this.x.fillStyle = cols[k][0];
            this.x.fillRect(i, j, 1, 1);
            break;
          }
        }
      }
    }
    return this;
  }
}

function hx(s: string): [number, number, number] {
  return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
}

function shade(hex: string, amount: number) {
  const [r, g, b] = hx(hex);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(amount < 0 ? v * (1 + amount) : v + (255 - v) * amount)));
  return `#${[f(r), f(g), f(b)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

// ---------------------------------------------------------------- shared palettes

const PLASTER: Weights = [["#e8dec6", 0.62], ["#ddd2b6", 0.26], ["#f1e9d6", 0.12]];
const PLASTERW: Weights = [["#f3f0e7", 0.6], ["#e7e3d8", 0.3], ["#fbf9f3", 0.1]];
const STONE: Weights = [["#8a847a", 0.4], ["#9b958a", 0.3], ["#6f6a62", 0.2], ["#aaa498", 0.1]];
const DK = "#3a2a21";
const DK2 = "#271c16";
const WD = "#6e4c37";
const WL = "#93694a";
const WARM = "#f0a24a";

// ---------------------------------------------------------------- ground

export const GROUND_UNITS = 64;
export const GROUND_TEXELS = 16;

const FIELD_ROWS = { wheat: ["#d8b65a", "#c9a64c", "#e4c66c", "#b8964a"], vines: ["#6a8a3a", "#8a6a44", "#5a7a34", "#7a5c3a"], rice: ["#7ccc5a", "#5aa848", "#9ad46a", "#4a8a4a"] };

/** The ground: grass, paths with dithered soft edges, forest floor, fields, sand, leaf litter. */
export function paintGround(plan: TownPlan, texels = GROUND_TEXELS) {
  const N = GROUND_UNITS * texels;
  const canvas = makeCanvas(N, N);
  const context = canvas.getContext("2d")!;
  const image = context.createImageData(N, N);
  const data = image.data;
  const g = plan.ground;
  const G3 = g.grass.map(hx);
  const TUFT = hx(g.tuft[0]);
  const TUFTL = hx(g.tuft[1]);
  const PA = hx(g.path.base);
  const PAL = hx(g.path.light);
  const PAD = hx(g.path.dark);
  const RIM = hx(g.rim[0]);
  const RIM2 = hx(g.rim[1]);
  const FO = g.forestFloor.map(hx);
  const WB = hx("#284f6e");
  const SAND = [hx(plan.snow ? "#e9e6e0" : "#e6d6a8"), hx(plan.snow ? "#d9d6d0" : "#d8c590"), hx("#f0e4be")];
  const LITTER = g.litter?.map(hx) ?? [];
  const deciduous = plan.trees.filter((tree) => tree.species !== plan.canopy && Math.abs(tree.x) < 30 && Math.abs(tree.z) < 32);
  // Young wheat is green in spring.
  const field = plan.field ? (plan.field === "wheat" && plan.season === "spring" ? ["#7e9a48", "#6f8a3e", "#8eaa52", "#5f7a36"] : FIELD_ROWS[plan.field]).map(hx) : null;
  const paved = plan.filler === "blocks";
  const toWorld = (i: number) => -GROUND_UNITS / 2 + (i + 0.5) / texels;
  const { pond, water } = plan;
  const forestDepth = (x: number, z: number) => {
    let inner: number;
    if (z > 12.7) inner = 16.3 - z;
    else inner = -Math.max(plan.bounds.x0 - x, x - plan.bounds.x1, plan.bounds.z0 - z);
    return -inner + (vn(x * 0.55, z * 0.55, 7) - 0.5) * 1.6;
  };
  for (let j = 0; j < N; j += 1) {
    const z = toWorld(j);
    for (let i = 0; i < N; i += 1) {
      const X = toWorld(i);
      const o = (j * N + i) * 4;
      const hh = h2(i, j, 1);
      const chk = (i + j) & 1;
      let col: [number, number, number];
      const inPond = pond && Math.abs(X - pond.x) < pond.w / 2 && Math.abs(z - pond.z) < pond.d / 2;
      const inChannel = (water.kind === "canal" || water.kind === "creek") && z > water.z0 && z < water.z1;
      if (inPond || inChannel) col = WB;
      else if (water.kind === "shore" && z > water.sand + (vn(X * 0.7, 3, 4) - 0.5) * 0.5) {
        const k = vn(X * 1.4, z * 1.4, 21);
        col = k > 0.7 ? SAND[2] : hh < 0.08 ? SAND[1] : SAND[0];
      } else {
        const pd = pathDistance(plan, X, z) + (vn(X * 2.2, z * 2.2, 2) - 0.5) * 0.12;
        const fd = forestDepth(X, z);
        if (pd < -0.1) {
          col = PA;
          if (paved) {
            // Paving: a coarse block grid.
            if (i % 8 === 0 || j % 8 === 0) col = PAD;
            else if (hh < 0.05) col = PAL;
          } else if (hh < 0.035) col = PAL;
          else if (hh < 0.07) col = PAD;
        } else if (pd < -0.03) col = chk ? PA : RIM;
        else if (pd < 0.06) col = RIM;
        else if (pd < 0.12) col = chk ? RIM : RIM2;
        else if (field && fd > 0.3) {
          // Field rows, running east to west, in bands.
          const band = Math.floor((z + 40) / 3.2) + Math.floor((X + 40) / 9);
          const row = j % 4;
          col = field[(row === 0 ? 1 : row === 2 ? 3 : 0 + (band % 2) * 2) % field.length];
          if (plan.snow) col = row === 0 ? hx("#c9c2b4") : hx("#eef1f3");
          if (Math.abs(((X + 40) % 9) - 0) < 0.08) col = PAD;
        } else if (fd > 0.3) {
          col = FO[0];
          const q = vn(X * 0.8, z * 0.8, 4);
          if (q > 0.62) col = FO[1];
          if (hh < 0.03) col = FO[2];
        } else if (fd > 0 && chk) col = FO[0];
        else {
          const n = vn(X * 0.3, z * 0.3, 5) * 0.78 + vn(X * 1.05, z * 1.05, 6) * 0.22;
          let level: number;
          if (n < 0.4) level = 0;
          else if (n < 0.44) level = chk ? 0 : 1;
          else if (n < 0.6) level = 1;
          else if (n < 0.64) level = chk ? 1 : 2;
          else level = 2;
          col = G3[level];
          const ti = (i / 6) | 0;
          const tj = (j / 6) | 0;
          if (h2(ti, tj, 12) < 0.03) {
            const lx = i - ti * 6;
            const ly = j - tj * 6;
            if ((ly === 2 && (lx === 1 || lx === 3)) || (ly === 3 && lx === 2)) col = level === 2 ? TUFT : level === 0 ? TUFTL : TUFT;
          }
        }
        if (LITTER.length) {
          for (let m = 0; m < deciduous.length; m += 1) {
            const t = deciduous[m];
            const dx = X - t.x;
            const dz = z - t.z;
            if (dx > 2.2 || dx < -2.2 || dz > 2.2 || dz < -2.2) continue;
            const rr = 1.1 * t.scale;
            const dd = Math.sqrt(dx * dx + dz * dz) / rr;
            if (dd < 1 && h2(i, j, 20 + m) < 0.22 * (1 - dd) + 0.03) {
              col = LITTER[Math.floor(h2(i, j, 31) * LITTER.length)];
              break;
            }
          }
        }
      }
      data[o] = col[0];
      data[o + 1] = col[1];
      data[o + 2] = col[2];
      data[o + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

/** A soft multiply decal: shade under trees, houses and around water. */
export function paintAO(plan: TownPlan) {
  const N = 512;
  const s = N / GROUND_UNITS;
  const canvas = makeCanvas(N, N);
  const x = canvas.getContext("2d")!;
  x.fillStyle = "#fff";
  x.fillRect(0, 0, N, N);
  const W = (v: number) => (v + GROUND_UNITS / 2) * s;
  for (const t of plan.trees) {
    for (const [radius, alpha] of [[(t.species === plan.canopy ? 1.05 : 1.2) * t.scale, ".6"], [0.42 * t.scale, ".7"]] as const) {
      const r = radius * s;
      const gradient = x.createRadialGradient(W(t.x), W(t.z), 0, W(t.x), W(t.z), r);
      gradient.addColorStop(0, `rgba(16,22,14,${alpha})`);
      gradient.addColorStop(1, "rgba(16,22,14,0)");
      x.fillStyle = gradient;
      x.fillRect(W(t.x) - r, W(t.z) - r, 2 * r, 2 * r);
    }
  }
  x.save();
  x.shadowColor = "rgba(16,18,14,.95)";
  x.shadowBlur = 7;
  x.fillStyle = "rgba(16,18,14,.9)";
  for (const h of plan.houses) x.fillRect(W(h.x - h.width / 2 - 0.05), W(h.z - h.depth / 2 - 0.05), (h.width + 0.1) * s, (h.depth + 0.1) * s);
  for (const b of plan.blocks) x.fillRect(W(b.x - b.w / 2), W(b.z - b.d / 2), b.w * s, b.d * s);
  x.shadowBlur = 5;
  if (plan.pond) x.fillRect(W(plan.pond.x - plan.pond.w / 2 - 0.15), W(plan.pond.z - plan.pond.d / 2 - 0.15), (plan.pond.w + 0.3) * s, (plan.pond.d + 0.3) * s);
  if (plan.water.kind === "canal") x.fillRect(0, W(plan.water.z0 - 0.12), N, (plan.water.z1 - plan.water.z0 + 0.24) * s);
  x.restore();
  return canvas;
}

// ---------------------------------------------------------------- Japanese houses (the prototype's)

function machiyaFront(): Pair {
  const W = 72, H = 58, a = new Painter(W, H), e = new Painter(W, H);
  e.r(0, 0, W, H, "#000");
  a.n(0, 0, W, 30, PLASTER, 11); a.r(0, 0, W, 2, DK); a.r(0, 2, W, 1, "#5b4234"); a.r(0, 0, 3, 30, DK); a.r(W - 3, 0, 3, 30, DK);
  const mx = 15, my = 9, mw = 42, mh = 13; a.r(mx - 1, my - 1, mw + 2, mh + 2, DK);
  for (let i = 0; i < mw; i += 1) { const k = i % 4; if (k < 2) a.r(mx + i, my, 1, mh, k === 0 ? "#f1e9d4" : "#d6cab0"); else { a.r(mx + i, my, 1, mh, "#1c1511"); e.r(mx + i, my + 1, 1, mh - 2, k === 2 ? "#b0662a" : "#8a4e20"); } }
  a.r(0, 28, W, 3, DK); a.r(0, 28, W, 1, "#5b4234");
  a.r(0, 31, W, 27, DK2);
  a.r(3, 33, 40, 21, "#21160f"); e.r(3, 33, 40, 21, "#d48638");
  for (let i = 3; i < 43; i += 1) if (i % 2 === 0) { a.r(i, 33, 1, 21, WD); a.p(i, 34, WL); e.r(i, 33, 1, 21, "#000"); }
  a.r(3, 33, 40, 1, DK); a.r(3, 43, 40, 1, WD); a.r(3, 53, 40, 1, DK); e.r(3, 33, 40, 1, "#000"); e.r(3, 43, 40, 1, "#000"); e.r(3, 53, 40, 1, "#000");
  a.r(0, 31, 3, 27, DK); a.r(44, 31, 3, 27, DK); a.r(W - 3, 31, 3, 27, DK); a.r(1, 31, 1, 27, "#4d382c"); a.r(45, 31, 1, 27, "#4d382c");
  a.r(47, 32, 22, 23, "#4a3326"); a.r(49, 42, 8, 12, "#56646a"); a.r(59, 42, 8, 12, "#56646a"); a.r(53, 42, 1, 12, "#4a3326"); a.r(63, 42, 1, 12, "#4a3326"); a.r(49, 47, 18, 1, "#4a3326");
  a.p(50, 43, "#8aa0a8"); a.p(60, 43, "#8aa0a8"); e.r(49, 42, 8, 12, WARM); e.r(59, 42, 8, 12, WARM); e.r(53, 42, 1, 12, "#000"); e.r(63, 42, 1, 12, "#000"); e.r(49, 47, 18, 1, "#000");
  a.r(46, 31, 24, 1, "#1a120d"); a.r(47, 32, 22, 10, "#2c4372"); a.r(47, 32, 22, 1, "#22355c"); a.r(57, 33, 2, 9, "#1b2a4a"); a.r(47, 41, 10, 1, "#4462a0"); a.r(59, 41, 10, 1, "#4462a0");
  a.n(0, 55, W, 3, STONE, 12); a.r(0, 54, W, 1, "#5a4a3c");
  return { m: a.c, e: e.c };
}
function machiyaSide(): Pair {
  const W = 46, H = 58, a = new Painter(W, H), e = new Painter(W, H);
  e.r(0, 0, W, H, "#000");
  a.n(0, 0, W, 30, PLASTER, 14); a.r(0, 0, W, 2, DK); a.r(0, 0, 2, H, DK); a.r(W - 2, 0, 2, H, DK); a.r(22, 0, 2, 30, DK); a.r(0, 14, W, 1, "#5b4234");
  a.r(28, 6, 10, 7, DK); a.r(29, 7, 8, 5, "#5a6e74"); a.r(33, 7, 1, 5, DK); e.r(29, 7, 8, 5, WARM); e.r(33, 7, 1, 5, "#000");
  a.r(0, 28, W, 3, DK);
  for (let j = 31; j < 55; j += 1) a.r(2, j, W - 4, 1, (j - 31) % 4 === 3 ? "#241a14" : (j - 31) % 4 === 0 ? "#55443a" : "#463830");
  for (let i = 2; i < W - 2; i += 7) a.r(i, 31, 1, 24, "#2a1f19");
  a.n(0, 55, W, 3, STONE, 15); a.r(0, 54, W, 1, "#5a4a3c");
  return { m: a.c, e: e.c };
}
function cottageFront(): Pair {
  const W = 52, H = 36, a = new Painter(W, H), e = new Painter(W, H);
  e.r(0, 0, W, H, "#000");
  a.n(0, 0, W, H, PLASTER, 21); a.r(0, 0, W, 2, DK); a.r(0, 0, 2, H, DK); a.r(W - 2, 0, 2, H, DK); a.r(27, 0, 2, H, DK);
  a.r(4, 8, 21, 19, DK); a.r(5, 9, 19, 17, "#efe8d4"); e.r(5, 9, 19, 17, "#ffcc80");
  for (let i = 5; i < 24; i += 1) if ((i - 5) % 5 === 4) { a.r(i, 9, 1, 17, "#8a6a4f"); e.r(i, 9, 1, 17, "#a8662c"); }
  for (let j = 9; j < 26; j += 1) if ((j - 9) % 4 === 3) { a.r(5, j, 19, 1, "#8a6a4f"); e.r(5, j, 19, 1, "#a8662c"); }
  a.r(4, 27, 21, 1, "#2a1e18");
  a.r(32, 9, 16, 24, DK); a.r(33, 10, 14, 23, "#6b4b36"); a.r(34, 11, 5, 12, "#55666c"); a.r(41, 11, 5, 12, "#55666c"); a.p(35, 12, "#94aab1"); a.p(42, 12, "#94aab1");
  e.r(34, 11, 5, 12, WARM); e.r(41, 11, 5, 12, WARM);
  for (let j = 11; j < 23; j += 3) { a.r(34, j, 12, 1, "#6b4b36"); e.r(34, j, 12, 1, "#000"); }
  a.r(32, 6, 16, 2, "#2a1e18"); a.r(30, 5, 20, 1, DK);
  a.n(0, 33, W, 3, STONE, 22);
  return { m: a.c, e: e.c };
}
function cottageSide(): Pair {
  const W = 54, H = 36, a = new Painter(W, H), e = new Painter(W, H);
  e.r(0, 0, W, H, "#000");
  for (let i = 0; i < W; i += 1) { const k = i % 5; a.r(i, 0, 1, 33, k === 4 ? "#523a28" : k === 0 ? "#987052" : "#86613f"); }
  a.n(0, 0, W, 33, [["rgba(0,0,0,0)", 0.85], ["rgba(40,25,15,.25)", 0.1], ["rgba(255,240,210,.15)", 0.05]], 23);
  a.r(0, 0, W, 2, DK); a.r(0, 0, 2, H, DK); a.r(W - 2, 0, 2, H, DK);
  a.r(30, 8, 14, 9, DK); a.r(31, 9, 12, 7, "#efe8d4"); a.r(37, 9, 1, 7, "#8a6a4f"); a.r(31, 12, 12, 1, "#8a6a4f"); e.r(31, 9, 12, 7, "#ffc778"); e.r(37, 9, 1, 7, "#000"); e.r(31, 12, 12, 1, "#000");
  a.n(0, 33, W, 3, STONE, 24);
  return { m: a.c, e: e.c };
}
function namako(a: Painter, X: number, Y: number, W: number, H: number) {
  a.r(X, Y, W, H, "#454b52");
  for (let j = 0; j < H; j += 1) for (let i = 0; i < W; i += 1) { const u = (i + j) % 6, v = (i - j + 600) % 6; if (u === 0 || v === 0) a.p(X + i, Y + j, "#e6e2d6"); else if (u === 1 || v === 1) a.p(X + i, Y + j, "#5a6168"); }
}
function kuraFront(): Pair {
  const W = 40, H = 46, a = new Painter(W, H), e = new Painter(W, H);
  e.r(0, 0, W, H, "#000");
  a.n(0, 0, W, 26, PLASTERW, 31); namako(a, 0, 27, W, 19); a.r(0, 26, W, 1, "#b8b3a6");
  a.r(15, 5, 10, 8, "#2b2724"); a.r(16, 6, 8, 6, "#3a3632"); a.r(19, 6, 2, 6, "#1d1a18"); a.r(14, 4, 12, 1, "#c9c4b6");
  a.r(14, 22, 12, 24, "#2f2722"); a.r(15, 23, 10, 23, "#45362c"); a.r(19, 23, 2, 23, "#2f2722"); for (let j = 26; j < 44; j += 5) { a.p(16, j, "#a39a8a"); a.p(23, j, "#a39a8a"); }
  a.r(13, 21, 14, 1, "#c9c4b6"); e.p(20, 30, "#7a4a20");
  return { m: a.c, e: e.c };
}
function kuraSide(): Pair {
  const W = 38, H = 46, a = new Painter(W, H), e = new Painter(W, H);
  e.r(0, 0, W, H, "#000");
  a.n(0, 0, W, 26, PLASTERW, 32); namako(a, 0, 27, W, 19); a.r(0, 26, W, 1, "#b8b3a6"); a.r(14, 8, 8, 6, "#2b2724"); a.r(17, 8, 2, 6, "#1d1a18");
  return { m: a.c, e: e.c };
}
function sidingRows(a: Painter, X: number, Y: number, W: number, H: number, s: number) {
  for (let j = 0; j < H; j += 1) a.r(X, Y + j, W, 1, j % 3 === 2 ? "#9e9b92" : j % 3 === 0 ? "#d6d3ca" : "#c4c1b8");
  a.n(X, Y, W, H, [["rgba(0,0,0,0)", 0.9], ["rgba(0,0,0,.06)", 0.1]], s);
}
function modernFront(): Pair {
  const W = 58, H = 50, a = new Painter(W, H), e = new Painter(W, H);
  e.r(0, 0, W, H, "#000");
  sidingRows(a, 0, 0, W, H, 41); a.r(0, 0, 1, H, "#8a877f"); a.r(W - 1, 0, 1, H, "#8a877f");
  const win = (X: number, Y: number, w: number, h: number) => { a.r(X, Y, w, h, "#7d8287"); a.r(X + 1, Y + 1, w - 2, h - 2, "#4f6574"); a.r(X + 1, Y + 1, w - 2, 1, "#7f99a8"); a.p(X + 2, Y + 2, "#a7c0cc"); a.r(X + (w >> 1), Y + 1, 1, h - 2, "#7d8287"); e.r(X + 1, Y + 1, w - 2, h - 2, "#ffbe6e"); e.r(X + (w >> 1), Y + 1, 1, h - 2, "#000"); };
  win(6, 6, 16, 11); win(34, 6, 18, 11); win(6, 30, 14, 10);
  a.r(36, 28, 12, 20, "#5b4a3d"); a.r(37, 29, 10, 19, "#7a634f"); a.r(45, 38, 1, 2, "#d8c27a"); a.r(34, 26, 16, 2, "#6c6b66");
  a.r(0, 47, W, 3, "#8f8b82");
  return { m: a.c, e: e.c };
}
function modernSide(): Pair {
  const W = 44, H = 50, a = new Painter(W, H), e = new Painter(W, H);
  e.r(0, 0, W, H, "#000");
  sidingRows(a, 0, 0, W, H, 42); a.r(14, 8, 12, 9, "#7d8287"); a.r(15, 9, 10, 7, "#4f6574"); a.r(15, 9, 10, 1, "#7f99a8"); e.r(15, 9, 10, 7, "#ffbe6e"); a.r(0, 47, W, 3, "#8f8b82");
  return { m: a.c, e: e.c };
}

const JAPANESE: Record<string, [() => Pair, () => Pair]> = {
  machiya: [machiyaFront, machiyaSide],
  cottage: [cottageFront, cottageSide],
  kura: [kuraFront, kuraSide],
  modern: [modernFront, modernSide],
};

// ---------------------------------------------------------------- generic houses

const WALL_BASE: Record<WallStyle, string> = {
  "tile-beige": "#d9ccb2",
  "siding-cream": "#d6d3ca",
  "stucco-ochre": "#d9a35a",
  "stucco-red": "#b8573f",
  "stucco-cream": "#e8d8b4",
  "stucco-white": "#efeae0",
  whitewash: "#f7f5ef",
  brick: "#9a4a34",
  brownstone: "#6e4a3a",
  glass: "#4f6b80",
  chalet: "#8a5a34",
  log: "#7a5232",
  "shingle-cedar": "#8a6a4a",
  "clapboard-blue": "#7392b2",
  "clapboard-red": "#a8433a",
  "clapboard-white": "#eeeae0",
  "barn-red": "#a33a2c",
  elevator: "#8a3e2e",
  craftsman: "#7d8a62",
  bali: "#a5523a",
  "stone-ochre": "#c79a5a",
  "brick-plaster": "#d8b48a",
};

function paintWall(a: Painter, style: WallStyle, W: number, H: number, seed: number, tone: number) {
  const base = shade(WALL_BASE[style], (tone - 0.5) * 0.12);
  const noise = (s: number): Weights => [[base, 0.62], [shade(base, -0.06), 0.26], [shade(base, 0.07), 0.12]];
  switch (style) {
    case "brick":
    case "bali":
      for (let j = 0; j < H; j += 1) {
        for (let i = 0; i < W; i += 1) {
          const row = Math.floor(j / 3);
          const mortar = j % 3 === 2 || (i + (row % 2) * 3) % 6 === 0;
          a.p(i, j, mortar ? (style === "bali" ? "#c9a58a" : "#c2b2a0") : h2(i >> 2, row, seed) < 0.3 ? shade(base, -0.12) : base);
        }
      }
      if (style === "bali") for (let j = 0; j < H; j += 12) a.r(0, j, W, 2, "#9a9688");
      break;
    case "stone-ochre":
      a.r(0, 0, W, H, "#b8a07a");
      for (let j = 0; j < H; j += 4) {
        let i = (j / 4) % 2 ? -2 : 0;
        while (i < W) {
          const w = 3 + Math.floor(h2(i, j, seed) * 4);
          a.r(i + 1, j + 1, w - 1, 3, h2(i, j, seed + 1) < 0.4 ? shade(base, -0.1) : base);
          i += w;
        }
      }
      break;
    case "log":
      for (let j = 0; j < H; j += 1) a.r(0, j, W, 1, j % 4 === 3 ? "#3e2818" : j % 4 === 0 ? shade(base, 0.15) : base);
      for (let j = 0; j < H; j += 4) { a.r(0, j, 2, 3, "#a87c52"); a.r(W - 2, j, 2, 3, "#a87c52"); }
      break;
    case "shingle-cedar":
    case "craftsman":
      for (let j = 0; j < H; j += 1) for (let i = 0; i < W; i += 1) {
        const row = Math.floor(j / 3);
        const edge = j % 3 === 2 || (i + row * 2) % 4 === 0;
        a.p(i, j, edge ? shade(base, -0.25) : h2((i + row * 2) >> 2, row, seed) < 0.35 ? shade(base, 0.08) : base);
      }
      break;
    case "clapboard-blue":
    case "clapboard-red":
    case "clapboard-white":
    case "siding-cream":
      for (let j = 0; j < H; j += 1) a.r(0, j, W, 1, j % 3 === 2 ? shade(base, -0.22) : j % 3 === 0 ? shade(base, 0.08) : base);
      break;
    case "barn-red":
    case "elevator":
      for (let i = 0; i < W; i += 1) a.r(i, 0, 1, H, i % 4 === 3 ? shade(base, -0.3) : i % 4 === 0 ? shade(base, 0.1) : base);
      a.n(0, 0, W, H, [["rgba(0,0,0,0)", 0.9], ["rgba(0,0,0,.12)", 0.1]], seed);
      break;
    case "glass":
      a.r(0, 0, W, H, base);
      for (let j = 0; j < H; j += 1) for (let i = 0; i < W; i += 1) if (i % 6 === 0 || j % 8 === 0) a.p(i, j, "#2f3c48");
      for (let j = 0; j < H; j += 1) if ((j * 3) % 37 < 6) a.r(1, j, W - 2, 1, "rgba(200,225,240,.18)");
      break;
    case "chalet": {
      const stone = Math.floor(H * 0.42);
      for (let i = 0; i < W; i += 1) a.r(i, 0, 1, H - stone, i % 5 === 4 ? "#4e3220" : i % 5 === 0 ? "#a06a40" : base);
      a.n(0, H - stone, W, stone, STONE, seed);
      for (let j = H - stone; j < H; j += 4) a.r(0, j, W, 1, "#5a554e");
      a.r(0, H - stone - 1, W, 1, "#3a2618");
      break;
    }
    case "brick-plaster":
      a.n(0, 0, W, H, noise(seed), seed);
      for (let k = 0; k < 5; k += 1) {
        const px = Math.floor(h2(k, 1, seed) * (W - 10));
        const py = Math.floor(h2(k, 2, seed) * (H - 8));
        for (let j = 0; j < 6; j += 1) for (let i = 0; i < 9; i += 1) a.p(px + i, py + j, j % 2 ? "#8a4a34" : (i + j) % 4 === 0 ? "#c2b2a0" : "#9a5a3c");
      }
      break;
    case "brownstone":
      a.n(0, 0, W, H, noise(seed), seed);
      for (let j = 0; j < H; j += 5) a.r(0, j, W, 1, shade(base, -0.12));
      break;
    default:
      a.n(0, 0, W, H, noise(seed), seed);
  }
}

const WINDOW_TRIM: Partial<Record<WindowStyle, string>> = { "shutter-green": "#3f6e4a", "shutter-blue": "#2f6aa8", "shutter-red": "#a8432a" };

function paintWindow(a: Painter, e: Painter, style: WindowStyle, X: number, Y: number, w: number, h: number, lit: boolean) {
  const glow = (gx: number, gy: number, gw: number, gh: number) => {
    if (lit) e.r(gx, gy, gw, gh, "#ffbe6e");
  };
  switch (style) {
    case "none":
      return;
    case "grid":
      a.r(X, Y, w, h, "#7d8287"); a.r(X + 1, Y + 1, w - 2, h - 2, "#4f6574"); a.r(X + 1, Y + 1, w - 2, 1, "#7f99a8"); a.r(X + (w >> 1), Y + 1, 1, h - 2, "#7d8287");
      glow(X + 1, Y + 2, w - 2, h - 3);
      return;
    case "curtain":
      a.r(X, Y, w, h, lit ? "#e6c88a" : "#3c5468");
      glow(X, Y, w, h);
      return;
    case "arched":
      a.r(X - 1, Y + 1, w + 2, h, "#e8dcc4"); a.r(X, Y + 2, w, h - 2, "#33404a"); a.r(X + 1, Y, w - 2, 2, "#e8dcc4"); a.r(X + 1, Y + 1, w - 2, 1, "#33404a");
      a.r(X + (w >> 1), Y + 2, 1, h - 2, "#e8dcc4");
      glow(X, Y + 2, w, h - 2);
      return;
    case "carved":
      a.r(X, Y, w, h, "#3a2418"); for (let j = 1; j < h - 1; j += 2) a.r(X + 1, Y + j, w - 2, 1, "#c99a3a");
      glow(X + 1, Y + 1, w - 2, h - 2);
      return;
    case "shopfront":
    case "small-wood":
    case "white-frame":
    case "black-frame":
    case "sash":
    case "shutter-green":
    case "shutter-blue":
    case "shutter-red": {
      const frame = style === "black-frame" ? "#22262c" : style === "small-wood" ? "#5a3a22" : style === "white-frame" || style === "sash" ? "#f2efe6" : "#e8e2d4";
      a.r(X, Y, w, h, frame);
      a.r(X + 1, Y + 1, w - 2, h - 2, "#3a4a58");
      a.p(X + 1, Y + 1, "#8aa4b4");
      a.r(X + (w >> 1), Y + 1, 1, h - 2, frame);
      if (style !== "black-frame") a.r(X + 1, Y + (h >> 1), w - 2, 1, frame);
      glow(X + 1, Y + 1, w - 2, h - 2);
      const trim = WINDOW_TRIM[style];
      if (trim) {
        for (let j = 0; j < h; j += 1) {
          a.r(X - 3, Y + j, 3, 1, j % 2 ? shade(trim, -0.2) : trim);
          a.r(X + w, Y + j, 3, 1, j % 2 ? shade(trim, -0.2) : trim);
        }
      }
      if (style === "sash") a.r(X - 1, Y + h, w + 2, 1, "#d8d0c0");
      return;
    }
  }
}

const DOOR_COLOUR: Record<DoorStyle, string> = {
  glass: "#3a4a58",
  noren: "#2c4372",
  arched: "#6a4024",
  portico: "#4a3226",
  "panel-black": "#1d2026",
  "panel-red": "#a8332a",
  "panel-green": "#3a6a48",
  stoop: "#3a2a22",
  wood: "#6b4b36",
  barn: "#8a2e22",
  blue: "#2f6aa8",
  carved: "#7a4a1e",
};

function paintDoor(a: Painter, e: Painter, style: DoorStyle, X: number, base: number, w: number, h: number) {
  const Y = base - h;
  const col = DOOR_COLOUR[style];
  if (style === "barn") {
    a.r(X - 1, Y - 1, w + 2, h + 1, "#f0ece2");
    a.r(X, Y, w, h, col);
    for (let k = 0; k < Math.min(w, h); k += 1) {
      a.p(X + Math.floor((k * w) / Math.min(w, h)), Y + k, "#f0ece2");
      a.p(X + w - 1 - Math.floor((k * w) / Math.min(w, h)), Y + k, "#f0ece2");
    }
    a.r(X + (w >> 1), Y, 1, h, "#f0ece2");
    return;
  }
  if (style === "arched" || style === "portico") {
    a.r(X - 1, Y, w + 2, h, "#d8ccb4");
    a.r(X, Y + 2, w, h - 2, col);
    a.r(X + 1, Y + 1, w - 2, 1, col);
    if (style === "portico") { a.r(X - 3, Y, 2, h, "#e8dcc4"); a.r(X + w + 1, Y, 2, h, "#e8dcc4"); }
  } else {
    a.r(X - 1, Y - 1, w + 2, h + 1, style === "noren" ? "#1a120d" : "#2a2420");
    a.r(X, Y, w, h, col);
  }
  if (style === "glass") {
    a.r(X + 1, Y + 1, w - 2, h - 1, "#5a7486");
    e.r(X + 1, Y + 1, w - 2, h - 1, "#ffbe6e");
  } else if (style === "noren") {
    a.r(X, Y + Math.floor(h * 0.45), w, h - Math.floor(h * 0.45), "#56646a");
    e.r(X, Y + Math.floor(h * 0.45), w, h - Math.floor(h * 0.45), WARM);
    a.r(X + (w >> 1), Y, 1, Math.floor(h * 0.45), "#1b2a4a");
  } else {
    a.r(X + 1, Y + 2, w - 2, 1, shade(col, 0.2));
    a.p(X + w - 2, Y + (h >> 1), "#d8c27a");
  }
}

function genericFacade(spec: HouseSpec, house: House, face: "front" | "side"): Pair {
  const W = face === "front" ? house.wp : house.dp;
  const H = house.hp;
  const a = new Painter(W, H);
  const e = new Painter(W, H);
  e.r(0, 0, W, H, "#000");
  const seed = (house.id.charCodeAt(0) * 7 + (face === "front" ? 1 : 2)) | 0;
  paintWall(a, spec.wall, W, H, seed, house.tone);
  const storeys = Math.max(1, spec.storeys);
  const floor = H / storeys;
  // A plinth.
  a.r(0, H - 2, W, 2, shade(WALL_BASE[spec.wall], -0.35));
  const curtain = spec.window === "curtain";
  for (let s = 0; s < storeys; s += 1) {
    const top = Math.round(s * floor);
    const ground = s === storeys - 1;
    const ww = curtain ? 4 : spec.window === "small-wood" ? 6 : 8;
    const wh = curtain ? 5 : Math.max(6, Math.min(12, Math.round(floor * 0.48)));
    const step = curtain ? 6 : 16;
    const count = Math.max(1, Math.floor((W - 6) / step));
    const start = Math.round((W - count * step) / 2 + (step - ww) / 2);
    for (let k = 0; k < count; k += 1) {
      const X = start + k * step;
      if (ground && face === "front" && !curtain && Math.abs(X + ww / 2 - W * 0.62) < 10) continue;
      const lit = h2(k, s, seed + 5) < 0.55;
      const style: WindowStyle = ground && spec.window === "shopfront" ? "black-frame" : spec.window === "shopfront" ? "grid" : spec.window;
      if (curtain) {
        for (let j = top + 1; j < top + floor - 1; j += 8) paintWindow(a, e, "curtain", X + 1, j + 1, 4, 6, h2(X, j, seed) < 0.35);
        continue;
      }
      paintWindow(a, e, style, X, top + Math.round((floor - wh) / 2) + 1, ground && spec.window === "shopfront" ? ww + 4 : ww, wh, lit);
    }
    if (s < storeys - 1 && !curtain && spec.wall !== "log") a.r(0, Math.round(top + floor) - 1, W, 1, shade(WALL_BASE[spec.wall], -0.18));
  }
  if (face === "front" && spec.door !== "carved" ? true : face === "front") {
    const dw = spec.door === "barn" ? Math.min(W - 8, 22) : spec.door === "portico" ? 12 : 10;
    const dh = Math.min(Math.round(floor * 0.82), spec.door === "barn" ? Math.round(H * 0.6) : 18);
    paintDoor(a, e, spec.door, Math.round(W * 0.62 - dw / 2), H - 2, dw, dh);
  }
  if (spec.extra === "awning" && face === "front") {
    const y = Math.round(H - floor) + 1;
    for (let i = 0; i < W; i += 1) a.r(i, y, 1, 3, Math.floor(i / 4) % 2 ? "#f2efe6" : "#c8402b");
  }
  return { m: a.c, e: e.c };
}

/** A house's front and side, with their lit windows. */
export function facades(house: House): { front: Pair; side: Pair } {
  const japanese = JAPANESE[house.kind];
  if (japanese) return { front: japanese[0](), side: japanese[1]() };
  const spec = HOUSE_SPECS[house.kind];
  return { front: genericFacade(spec, house, "front"), side: genericFacade(spec, house, "side") };
}

export function gableTexture(house: House) {
  const spec = HOUSE_SPECS[house.kind];
  const a = new Painter(32, 16);
  if (house.kind === "modern") sidingRows(a, 0, 0, 32, 16, 43);
  else if (spec.painter === "generic") paintWall(a, spec.wall === "chalet" ? "log" : spec.wall, 32, 16, 44, house.tone);
  else a.n(0, 0, 32, 16, house.kind === "kura" ? PLASTERW : PLASTER, 44);
  if (house.kind === "machiya" || house.kind === "cottage") {
    a.r(0, 14, 32, 2, DK);
    a.r(15, 0, 2, 16, DK);
  }
  return a.c;
}

const ROOF_SNOW: Weights = [["#f4f6f8", 0.7], ["#e2e8ee", 0.2], ["#ffffff", 0.1]];

export function roofTexture(wpx: number, hpx: number, style: RoofStyle, snow: boolean) {
  const W = Math.max(4, wpx);
  const H = Math.max(4, hpx);
  const a = new Painter(W, H);
  switch (style) {
    case "metal":
    case "metal-red":
    case "metal-green": {
      const base = style === "metal" ? "#50565c" : style === "metal-red" ? "#8e3a30" : "#3e5e44";
      for (let i = 0; i < W; i += 1) {
        const k = i % 5;
        a.r(i, 0, 1, H, k === 0 ? shade(base, 0.25) : k === 4 ? shade(base, -0.3) : base);
      }
      a.r(0, H - 2, W, 2, shade(base, -0.4));
      break;
    }
    case "terracotta": {
      const P = ["#d9784a", "#c2603a", "#a84a2c", "#8a3a22"];
      for (let i = 0; i < W; i += 1) a.r(i, 0, 1, H, P[i % 4]);
      for (let j = 0; j < H; j += 1) if (j % 4 === 3) for (let i = 0; i < W; i += 1) if (i % 4 !== 0) a.p(i, j, "#7a3020");
      a.n(0, 0, W, H, [["rgba(0,0,0,0)", 0.86], ["rgba(255,220,180,.12)", 0.08], ["rgba(0,0,0,.12)", 0.06]], 52);
      break;
    }
    case "slate":
      a.r(0, 0, W, H, "#4f5866");
      for (let j = 0; j < H; j += 1) for (let i = 0; i < W; i += 1) {
        const row = j >> 2;
        if (j % 4 === 3 || (i + row * 3) % 6 === 0) a.p(i, j, "#353c46");
        else if (h2((i + row * 3) >> 2, row, 53) < 0.25) a.p(i, j, "#5e6876");
      }
      break;
    case "shingle":
    case "shingle-dark": {
      const base = style === "shingle" ? "#7a5a3c" : "#4a4448";
      for (let j = 0; j < H; j += 1) for (let i = 0; i < W; i += 1) {
        const row = j >> 2;
        a.p(i, j, j % 4 === 3 || (i + row * 2) % 5 === 0 ? shade(base, -0.35) : h2((i + row * 2) / 5, row, 54) < 0.3 ? shade(base, 0.12) : base);
      }
      break;
    }
    case "thatch":
      for (let i = 0; i < W; i += 1) for (let j = 0; j < H; j += 1) {
        const r = h2(i, j >> 1, 55);
        a.p(i, j, r < 0.2 ? "#8a6a32" : r < 0.55 ? "#b8954e" : r < 0.85 ? "#a8853e" : "#d4b46a");
      }
      for (let j = 0; j < H; j += 6) a.r(0, j, W, 1, "#6e5228");
      break;
    case "flat":
    case "flat-white":
      a.n(0, 0, W, H, style === "flat" ? [["#8a8a86", 0.7], ["#7a7a76", 0.3]] : [["#ece8e0", 0.7], ["#dcd8d0", 0.3]], 56);
      break;
    case "kawara":
    default: {
      const P = ["#78818d", "#5b6470", "#505862", "#3b414a"];
      for (let i = 0; i < W; i += 1) a.r(i, 0, 1, H, P[i % 4]);
      for (let j = 0; j < H; j += 1) if (j % 5 === 4) for (let i = 0; i < W; i += 1) if (i % 4 !== 0) a.p(i, j, "#343a42");
      a.n(0, 0, W, H, [["rgba(0,0,0,0)", 0.88], ["rgba(255,255,255,.08)", 0.06], ["rgba(0,0,0,.12)", 0.06]], 51);
      for (let i = 0; i < W; i += 1) {
        const k = i % 4;
        a.p(i, H - 1, k === 0 ? "#9aa3ad" : k === 3 ? "#2c3138" : "#5b636d");
        a.p(i, H - 2, k === 0 ? "#7f8893" : "#48505a");
      }
    }
  }
  if (snow && style !== "flat" && style !== "flat-white") {
    // Snow lies on the roof, thinning at the eaves.
    for (let j = 0; j < H; j += 1) for (let i = 0; i < W; i += 1) if (h2(i, j, 57) < 0.95 - (j / H) * 0.35) a.p(i, j, ROOF_SNOW[h2(i, j, 58) < 0.7 ? 0 : 1][0]);
  }
  return a.c;
}

export function woodTexture() {
  const a = new Painter(16, 16);
  for (let i = 0; i < 16; i += 1) a.r(i, 0, 1, 16, i % 4 === 3 ? "#5a3f2c" : i % 4 === 0 ? "#9a7354" : "#83603f");
  a.n(0, 0, 16, 16, [["rgba(0,0,0,0)", 0.85], ["rgba(0,0,0,.15)", 0.15]], 61);
  return a.c;
}

export function stoneTexture() {
  const a = new Painter(32, 16);
  a.r(0, 0, 32, 16, "#6e6961");
  [[0, 5], [5, 6], [11, 5]].forEach((row, ri) => {
    let x = ri * 3;
    while (x < 40) {
      const w = 5 + ((h2(x, ri, 62) * 5) | 0);
      const c = ["#9c968b", "#8b857a", "#a9a397", "#7f796f"][(h2(x, ri, 63) * 4) | 0];
      a.r(x % 32, row[0], Math.min(w - 1, 32 - (x % 32)), row[1] - 1, c);
      a.r(x % 32, row[0], Math.min(w - 1, 32 - (x % 32)), 1, "#b5afa3");
      x += w;
    }
  });
  return a.c;
}

export function waterTexture(tint: "pond" | "sea" | "lake") {
  const a = new Painter(32, 32);
  const base: Weights =
    tint === "sea" ? [["#2f74a8", 0.75], ["#3a82b8", 0.2], ["#286494", 0.05]] : tint === "lake" ? [["#3a8ea0", 0.75], ["#46a0b0", 0.2], ["#307e90", 0.05]] : [["#3d7fae", 0.75], ["#4589b8", 0.2], ["#367198", 0.05]];
  a.n(0, 0, 32, 32, base, 71);
  for (let k = 0; k < 5; k += 1) {
    const y0 = k * 6 + 2;
    const ph = k * 7;
    for (let i = 0; i < 32; i += 1) {
      const y = y0 + Math.round(Math.sin(((i + ph) / 32) * Math.PI * 2) * 1.4);
      if ((i + k * 3) % 16 < 9) a.p(i, (y + 32) % 32, tint === "sea" ? "#7cc0e4" : "#79b6dc");
      if ((i + k * 3) % 16 < 3) a.p(i, (y + 33) % 32, "#5c9ccb");
    }
  }
  return a.c;
}

// ---------------------------------------------------------------- trees

/** Six crown colours: under, rim, base, mid, light, highlight. */
const LOBES: Partial<Record<TreeSpecies, string[]>> = {
  "maple-red": ["#5a1814", "#7e2219", "#c43a28", "#de5530", "#f08a3c", "#ffbe68"],
  "maple-orange": ["#6a2c12", "#8e3c17", "#df772b", "#ec953a", "#f8bd58", "#ffe08c"],
  ginkgo: ["#6a4e10", "#8e6a14", "#e0ae2c", "#eec43e", "#f8de6c", "#fff4b2"],
  "maple-green": ["#1e4a1c", "#2a5e24", "#4a8e34", "#5ea43e", "#86c25a", "#b6e07c"],
  "ginkgo-green": ["#2a4e18", "#3a6420", "#6aa03a", "#7eb444", "#a6d06a", "#d2ec9a"],
  cherry: ["#6a3a48", "#8e4a5c", "#e48aa4", "#f0a2b8", "#f8c6d4", "#fff0f4"],
  oak: ["#1c3a1a", "#26481e", "#3e6a2c", "#4c7a34", "#6a9446", "#92b45e"],
  olive: ["#2e3c2a", "#3e4e36", "#6a7e5a", "#7c8e68", "#9cac84", "#c4d0a8"],
  plane: ["#244a1e", "#2e5a24", "#4e8a36", "#5e9a40", "#80b656", "#a8d074"],
  "plane-gold": ["#5a3e14", "#7a5418", "#c08a2e", "#d49c38", "#e8bc5a", "#f6dc8a"],
  aspen: ["#2a4e18", "#3a6420", "#6eaa3a", "#82bc46", "#a8d464", "#d4ee96"],
  "aspen-gold": ["#6a4e10", "#8e6a14", "#e0ae2c", "#eec43e", "#f8de6c", "#fff4b2"],
  birch: ["#3a5418", "#4a6a20", "#86b444", "#98c450", "#b8da70", "#e0f0a0"],
  broadleaf: ["#123e1a", "#1a4e20", "#2e7a2e", "#3a8e36", "#5aac4a", "#8ccc6a"],
  poplar: ["#1e4a1c", "#2a5e24", "#4a8e34", "#5ea43e", "#86c25a", "#b6e07c"],
  "poplar-gold": ["#6a4e10", "#8e6a14", "#d8a02a", "#e6b63a", "#f2d266", "#fff0a8"],
  cypress: ["#0e2618", "#14301e", "#244a2c", "#2c5634", "#3e6c44", "#5a8a5a"],
  euphorbia: ["#24402a", "#2e4e32", "#4e7a4a", "#5e8a56", "#7ea470", "#a8c48e"],
  banana: ["#1e5a1e", "#2a6e24", "#4a9e34", "#5eb03e", "#86cc5a", "#b6e87c"],
};

export function lobePalette(species: TreeSpecies) {
  return LOBES[species] ?? LOBES["maple-green"]!;
}

export function lobeTexture(P: string[], s: number) {
  const W = 32, H = 32, a = new Painter(W, H);
  a.r(0, 0, W, H, P[2]); a.r(0, 0, W, 8, P[3]);
  const puff = (x: number, y: number, lit: boolean) => {
    const q = (dx: number, dy: number, c: string) => a.p((((x + dx) % W) + W) % W, y + dy, c);
    q(1, 0, lit ? P[5] : P[4]); q(2, 0, lit ? P[5] : P[4]); q(3, 0, P[4]); q(0, 1, lit ? P[5] : P[4]); q(1, 1, P[4]); q(2, 1, P[4]); q(3, 1, P[3]); q(4, 1, P[3]);
    q(0, 2, P[3]); q(1, 2, P[3]); q(2, 2, P[3]); q(3, 2, P[3]); q(4, 2, P[2]); q(0, 3, P[1]); q(1, 3, P[2]); q(2, 3, P[2]); q(3, 3, P[2]); q(4, 3, P[1]); q(1, 4, P[1]); q(2, 4, P[1]); q(3, 4, P[1]);
  };
  for (let r = 0; r < 3; r += 1) { const y = 4 + r * 4; for (let c = 0; c < 6; c += 1) puff(c * 6 + (r & 1) * 3 + ((h2(c, r, s) * 2) | 0), y, r === 0); }
  a.r(0, 0, W, 5, P[4]); for (let k = 0; k < W; k += 4) { a.p(k + ((h2(k, 1, s) * 3) | 0), 1 + ((h2(k, 2, s) * 3) | 0), P[5]); a.p(k + 2, 4, P[3]); }
  for (let i = 0; i < W; i += 1) { const b = [0, 1, 1, 1, 0, 0][i % 6]; a.p(i, 16 + b, P[3]); a.r(i, 17 + b, 1, 4 - b, P[1]); }
  a.r(0, 21, W, 11, P[0]); a.n(0, 21, W, 11, [[P[0], 0.85], [P[1], 0.15]], s + 7);
  return a.c;
}

/** Tiered conifer crowns: [base noise, top noise, light needle, mid, rim, underside]. */
const TIERS: Partial<Record<TreeSpecies, string[]>> = {
  cedar: ["#2e6a3b", "#296137", "#367644", "#3c8248", "#357a42", "#62a45a", "#4c8e4e", "#23502e", "#6fae62", "#3a7d45", "#14341f", "#1d4428", "#173a22", "#1e4529"],
  spruce: ["#24503a", "#1e4632", "#2c5c42", "#2f6446", "#2a5a40", "#4e8a66", "#3a7456", "#173a2a", "#5a967a", "#2e6a4e", "#0e2a1e", "#163626", "#11301f", "#183a28"],
  fir: ["#2a5834", "#244e2e", "#32683c", "#367040", "#30683a", "#5a9a5a", "#447e48", "#1a3e24", "#64a466", "#346e3e", "#102c18", "#18381f", "#13321c", "#1a3c22"],
  larch: ["#5a8a3a", "#4e7e32", "#68984a", "#74a454", "#6a9a4c", "#a2cc78", "#86b45e", "#36562a", "#b2d686", "#6a9a4c", "#22401a", "#2e4e22", "#28461e", "#304e24"],
  "larch-gold": ["#c09a32", "#b08a2a", "#cca63e", "#d8b44a", "#cca63e", "#f2d878", "#e0c058", "#7a5a1a", "#fae498", "#d0aa40", "#4a3410", "#5e4416", "#523c12", "#644818"],
};

export function tierPalette(species: TreeSpecies) {
  return TIERS[species] ?? TIERS.cedar!;
}

export function tierTexture(P: string[], seed: number) {
  const W = 32, H = 32, a = new Painter(W, H);
  a.n(0, 0, W, 16, [[P[0], 0.62], [P[1], 0.3], [P[2], 0.08]], seed);
  a.n(0, 0, W, 6, [[P[3], 0.6], [P[4], 0.4]], seed + 1);
  for (let k = 0; k < 34; k += 1) { const x = (h2(k, 1, seed + 2) * W) | 0, y = 1 + ((h2(k, 2, seed + 2) * 10) | 0), lt = y < 6; a.p(x, y, lt ? P[5] : P[6]); a.p((x + 1) % W, y + 1, lt ? P[6] : P[7]); a.p((x + W - 1) % W, y + 1, lt ? P[6] : P[7]); }
  for (let i = 0; i < W; i += 1) { const t = i % 4, top = t === 1 || t === 2 ? 11 : 12; a.p(i, top, P[8]); a.r(i, top + 1, 1, 14 - top, P[9]); a.p(i, 15, P[10]); if (t === 0 || t === 3) a.p(i, 14, P[10]); if (t === 0) a.p(i, 13, P[11]); }
  a.r(0, 16, W, 16, P[12]); a.n(0, 17, W, 15, [[P[12], 0.8], [P[13], 0.2]], seed + 3);
  return a.c;
}

/** A palm or banana leaf: a long blade with a midrib, lighter at the tip. */
export function leafTexture(species: TreeSpecies) {
  const P = lobePalette(species === "palm" ? "broadleaf" : species);
  const a = new Painter(16, 32);
  for (let j = 0; j < 32; j += 1) {
    for (let i = 0; i < 16; i += 1) {
      const across = Math.abs(i - 7.5) / 7.5;
      const notch = species === "palm" && (j + (i < 8 ? 0 : 2)) % 4 === 0 && across > 0.3;
      a.p(i, j, notch ? P[1] : across < 0.12 ? P[5] : across < 0.5 ? (j < 10 ? P[4] : P[3]) : across < 0.85 ? P[2] : P[1]);
    }
  }
  return a.c;
}

export function trunkTexture(kind: "bark" | "white" | "palm") {
  const a = new Painter(8, 16);
  if (kind === "white") {
    a.r(0, 0, 8, 16, "#e8e4da");
    for (let k = 0; k < 10; k += 1) a.r((h2(k, 1, 91) * 7) | 0, (h2(k, 2, 91) * 16) | 0, 2, 1, "#2a2622");
  } else if (kind === "palm") {
    for (let j = 0; j < 16; j += 1) a.r(0, j, 8, 1, j % 3 === 0 ? "#5a4430" : j % 3 === 1 ? "#8a6c4c" : "#7a5c3e");
  } else {
    for (let i = 0; i < 8; i += 1) a.r(i, 0, 1, 16, i % 3 === 0 ? "#3a2a20" : "#4a3428");
  }
  return a.c;
}

// ---------------------------------------------------------------- props and signs

export function mumTexture(f1: string, f2: string) {
  const a = new Painter(16, 16);
  a.n(0, 0, 16, 16, [["#4f7a3a", 0.6], ["#3c6230", 0.3], ["#5f8a44", 0.1]], 91);
  for (let k = 0; k < 14; k += 1) { const x = (h2(k, f1.length, 3) * 16) | 0, y = (h2(k, 7, 4) * 16) | 0, c = k % 3 === 0 ? f2 : f1; a.p(x, y, c); a.p((x + 1) % 16, y, c); a.p(x, (y + 1) % 16, c); }
  return a.c;
}

export function shrubTexture(colours: readonly string[]) {
  const a = new Painter(16, 16);
  a.n(0, 0, 16, 16, [[colours[0], 0.4], [colours[1], 0.3], [colours[2], 0.2], [colours[3], 0.1]], 95);
  return a.c;
}

/** A sign's board: her route's number and an arrow the way it leaves. */
export function signTexture(label: string, side: -1 | 1) {
  const W = 32, H = 12, a = new Painter(W, H);
  a.r(0, 0, W, H, "#4b3324"); a.r(1, 1, W - 2, H - 2, "#d9b98a"); a.n(1, 1, W - 2, H - 2, [["rgba(0,0,0,0)", 0.8], ["rgba(120,80,40,.18)", 0.2]], 101);
  a.r(1, H - 2, W - 2, 1, "#b8955f");
  const tw = measureText(label, true);
  drawText(a.x, label, side < 0 ? W - tw - 3 : 3, 2, C.ink, true);
  const ax = side < 0 ? 2 : W - 9;
  for (let k = 0; k < 3; k += 1) { const cx = side < 0 ? ax + k : ax + 6 - k; a.r(cx, 5 - k, 1, 1 + 2 * k, C.acc2); }
  a.r(side < 0 ? ax + 3 : ax, 5, 4, 1, C.acc2);
  return a.c;
}

export function vendingTexture(): Pair {
  const W = 14, H = 28, a = new Painter(W, H), e = new Painter(W, H);
  e.r(0, 0, W, H, "#000"); a.r(0, 0, W, H, "#e9ecef"); a.r(0, 0, W, 1, "#bfc4c9");
  a.r(1, 2, 12, 14, "#2c3a4a"); e.r(1, 2, 12, 14, "#cfe6ff");
  const cols = ["#e8503a", "#3a7bd5", "#f2c14e", "#4caf6a", "#ffffff", "#9b59b6"];
  for (let r = 0; r < 3; r += 1) for (let i = 0; i < 4; i += 1) { const c = cols[(r * 4 + i * 5) % 6]; a.r(2 + i * 3, 3 + r * 5, 2, 3, c); a.p(2 + i * 3, 3 + r * 5, "#ffffff"); e.r(2 + i * 3, 3 + r * 5, 2, 3, "#000"); a.p(2 + i * 3, 7 + r * 5, "#7cff9a"); e.p(2 + i * 3, 7 + r * 5, "#7cff9a"); }
  a.r(2, 18, 6, 3, "#1d2433"); a.r(10, 18, 2, 4, "#7d8287"); a.r(2, 23, 10, 3, "#2a2f35"); a.r(0, H - 1, W, 1, "#8a8f94");
  return { m: a.c, e: e.c };
}

/** A city block's facade: rows of windows, some lit. */
export function blockTexture(): Pair {
  const W = 32, H = 64, a = new Painter(W, H), e = new Painter(W, H);
  e.r(0, 0, W, H, "#000");
  a.n(0, 0, W, H, [["#d8d4cc", 0.7], ["#ccc8c0", 0.3]], 111);
  for (let j = 2; j < H - 2; j += 6) for (let i = 2; i < W - 2; i += 6) {
    a.r(i, j, 4, 4, "#3a4652"); a.p(i, j, "#7f99a8");
    if (h2(i, j, 112) < 0.4) e.r(i, j, 4, 4, "#ffc47a");
  }
  return { m: a.c, e: e.c };
}

/** Her route's line, drawn in pixels on a transparent canvas, revealed to `share`. */
export function paintTrail(canvas: HTMLCanvasElement, trail: ReadonlyArray<[number, number]>, toTexel: (x: number, z: number) => [number, number], share: number) {
  const context = context2d(canvas);
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (trail.length < 2) return;
  const upTo = Math.max(1, Math.floor((trail.length - 1) * Math.min(1, share)));
  const dot = (x: number, y: number, size: number, colour: string) => {
    context.fillStyle = colour;
    context.fillRect(Math.round(x - size / 2), Math.round(y - size / 2), size, size);
  };
  for (const [colour, size] of [[C.ink, 8], [C.acc, 4]] as const) {
    for (let i = 1; i <= upTo; i += 1) {
      const [x0, y0] = toTexel(trail[i - 1][0], trail[i - 1][1]);
      const [x1, y1] = toTexel(trail[i][0], trail[i][1]);
      const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
      for (let s = 0; s <= steps; s += 1) dot(x0 + ((x1 - x0) * s) / steps, y0 + ((y1 - y0) * s) / steps, size, colour);
    }
  }
  const [hx0, hy0] = toTexel(trail[upTo][0], trail[upTo][1]);
  dot(hx0, hy0, 12, C.ink);
  dot(hx0, hy0, 8, "#ffffff");
}
