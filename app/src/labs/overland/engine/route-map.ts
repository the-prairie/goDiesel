// A route as a little pixel map: her real line, worn into ground that is
// grown from the place's biome, with water, tall grass, ledges for climb,
// trees, houses and rocks, and a signpost at the start. Deterministic per route.

import { context2d, makeCanvas, sprite, type Ctx } from "@/labs/overland/engine/canvas";
import { fbm, hash } from "@/labs/overland/engine/noise";
import { C } from "@/labs/overland/engine/palette";
import type { Biome } from "@/labs/overland/model/place-biomes";

interface BiomeStyle {
  ground: [string, string, string];
  trees: [TreeKind, TreeKind, TreeKind];
  treeColour: keyof typeof TREE_COLOURS;
  water: "sea" | "lake" | "pond" | "river";
  rock: number;
  snow?: boolean;
  reeds?: boolean;
  crop?: boolean;
  city?: boolean;
  sand?: boolean;
}

type TreeKind = keyof typeof TREES;

const TREES = {
  round: [".....oooooo.....", "...oollmmmmoo...", "..ollllmmmmmdo..", ".olllmmmlmmmmdo.", ".ollmmmmmmmmmdo.", "olmmmmlmmmmmmddo", "olmmmmmmmmmmdddo", "ommmmmmmmmmmdddo", "odmmmmmmmmmddddo", ".odmmmmmmmddddo.", "..oddddddddddo..", "...oooddddooo...", "......otTo......", "......otTo......", ".....ootToo.....", "....sssssssss..."],
  pine: [".......oo.......", "......olmo......", ".....olmmdo.....", "....olmmmddo....", "...olmmmmmddo...", "....oddddddo....", "....olmmmmdo....", "...olmmmmmmdo...", "..olmmmmmmmddo..", ".olmmmmmmmmdddo.", ".oddddddddddddo.", "..ooodddddddoo..", "......otTo......", "......otTo......", ".....sotTos.....", "....ssssssss...."],
  palm: ["...ooo....ooo...", "..ollmo..omllo..", ".olmmmmoommmmdo.", "olmo.ommmmo.omdo", "oo..olmddmdo..oo", "...olo.tT.odo...", "...oo..tT..oo...", ".......tT.......", "......tT........", "......tT........", "......tTt.......", ".......tT.......", ".......tT.......", "......otTo......", ".....sstTss.....", "....ssssssss...."],
  small: ["................", "................", "................", "................", ".....oooooo.....", "...oollmmmmoo...", "..ollmmmmmmmdo..", "..olmmmlmmmmdo..", "..ommmmmmmmddo..", "..odmmmmmmdddo..", "...oddddddddo...", "....oooTtooo....", "......otTo......", "......otTo......", ".....ssssss.....", "................"],
};
const HOUSE = ["................", "...oooooooooo...", "..orrRrrrRrrro..", ".orrrrrrrrrrrro.", "orrRrrrRrrrRrrro", "oRRRRRRRRRRRRRRo", "oooooooooooooooo", ".owwwwwwwwwwwwo.", ".owggwwwwwwggwo.", ".owggwwoowwggwo.", ".owwwwoDDowwwwo.", ".oWWWWoDDoWWWWo.", ".oooooooooooooo.", "..ssssssssssss..", "................", "................"];
const BLOCK = [".oooooooooooooo.", ".oppppppppppppo.", ".oPPPPPPPPPPPPo.", ".owwwwwwwwwwwwo.", ".owgwgwgwgwgwwo.", ".owgwgwgwgwgwwo.", ".owwwwwwwwwwwwo.", ".owgwgwgwgwgwwo.", ".owgwgwgwgwgwwo.", ".owwwwwwwwwwwwo.", ".oWWWWooooWWWWo.", ".oWWWWoggoWWWWo.", ".oooooooooooooo.", "..ssssssssssss..", "................", "................"];
const ROCK = ["................", "................", ".....oooooo.....", "...oollllmmoo...", "..ollllmmmmmdo..", ".ollmmmmmmmmmdo.", ".olmmmmmmmmmddo.", "oommmmmmmmmdddoo", "odmmmmmmmmdddddo", ".odddmmmmddddoo.", "..oooddddddooo..", "....ssssssss....", "................", "................", "................", "................"];

const BIOME_STYLES: Record<Biome, BiomeStyle> = {
  pnw: { ground: ["#b2dc86", "#86c066", "#5f9e55"], trees: ["pine", "pine", "round"], treeColour: "green", water: "sea", rock: 0.15 },
  alpine: { ground: ["#b6dc8a", "#8bc46a", "#629f58"], trees: ["pine", "pine", "pine"], treeColour: "green", water: "lake", rock: 0.5, snow: true },
  swamp: { ground: ["#a9d07f", "#82b264", "#5e9152"], trees: ["pine", "round", "round"], treeColour: "deep", water: "pond", rock: 0.05, reeds: true },
  prairie: { ground: ["#efdb93", "#dcc46e", "#bba052"], trees: ["round", "small", "small"], treeColour: "green", water: "river", rock: 0, crop: true },
  calif: { ground: ["#f0d995", "#dec072", "#bf9f55"], trees: ["round", "small", "round"], treeColour: "oak", water: "sea", rock: 0.15 },
  city: { ground: ["#e4e0d6", "#d0cbbf", "#b0ab9e"], trees: ["round", "small", "round"], treeColour: "green", water: "river", rock: 0, city: true },
  med: { ground: ["#dcdb98", "#c0c477", "#9fa65f"], trees: ["small", "round", "small"], treeColour: "olive", water: "sea", rock: 0.35 },
  volc: { ground: ["#cdb7a0", "#ad967f", "#8a7461"], trees: ["palm", "small", "palm"], treeColour: "green", water: "sea", rock: 0.4, sand: true },
  jungle: { ground: ["#a6e07c", "#73c35a", "#4d9b4c"], trees: ["palm", "round", "palm"], treeColour: "jungle", water: "sea", rock: 0.1 },
  japan: { ground: ["#c2dc8e", "#9cc472", "#79a560"], trees: ["round", "round", "pine"], treeColour: "maple", water: "river", rock: 0.1 },
  farm: { ground: ["#c7e28e", "#a1cb6e", "#7da95b"], trees: ["round", "small", "round"], treeColour: "green", water: "river", rock: 0, crop: true },
};

const TREE_COLOURS = {
  green: ["#a9d978", "#6fae55", "#3f7c43", "#22432c"],
  deep: ["#8cc56c", "#56954d", "#356a3e", "#1d3b28"],
  oak: ["#9cc767", "#5f9a4a", "#3d6d3b", "#22402a"],
  olive: ["#c3cf98", "#93a272", "#687653", "#3a4433"],
  jungle: ["#9ee36e", "#55b34f", "#2f7c3f", "#173e25"],
  maple: ["#ffc06a", "#f0813f", "#c0492f", "#5a2620"],
  maple2: ["#ffe08a", "#f4b247", "#cc7a2a", "#5a3420"],
} as const;

const spriteCache = new Map<string, HTMLCanvasElement>();
function cached(key: string, make: () => HTMLCanvasElement) {
  let canvas = spriteCache.get(key);
  if (!canvas) {
    canvas = make();
    spriteCache.set(key, canvas);
  }
  return canvas;
}

function treeSprite(kind: TreeKind, colour: keyof typeof TREE_COLOURS) {
  return cached(`tree:${kind}:${colour}`, () => {
    const p = TREE_COLOURS[colour];
    return sprite(TREES[kind], { o: p[3], d: p[2], m: p[1], l: p[0], t: C.t1, T: C.t2, s: "rgba(20,40,30,.18)" });
  });
}

function houseSprite(kind: "house" | "block", roof: "red" | "blue" | "green") {
  return cached(`house:${kind}:${roof}`, () => {
    const [r, R] = { red: [C.rf, C.rf2], blue: [C.rb, C.rb2], green: [C.rg, C.rg2] }[roof];
    return sprite(kind === "block" ? BLOCK : HOUSE, {
      o: C.ink, r, R, w: C.wall, W: C.wall2, g: C.glass, D: C.t2, p: "#c9ccd3", P: "#a4a9b6", s: "rgba(20,30,40,.2)",
    });
  });
}

function rockSprite() {
  return cached("rock", () => sprite(ROCK, { o: C.r4, d: C.r3, m: C.r2, l: C.r1, s: "rgba(20,30,40,.18)" }));
}

function mountain(width: number, height: number, snow: boolean) {
  return cached(`mountain:${width}:${height}:${snow}`, () => {
    const canvas = makeCanvas(width, height);
    const x = context2d(canvas);
    const mid = width / 2;
    for (let y = 0; y < height; y += 1) {
      const half = Math.round(((y + 1) * mid) / height);
      for (let i = Math.ceil(mid - half); i < Math.floor(mid + half); i += 1) {
        const left = i < mid;
        let colour: string = left ? C.r1 : C.r2;
        if (snow && y < height * 0.34) colour = left ? C.n1 : C.n2;
        else if (snow && y < height * 0.42 && (i + y) % 2 === 0) colour = left ? C.n1 : C.n2;
        if (!left && i - mid > half * 0.55) colour = snow && y < height * 0.34 ? C.n3 : C.r3;
        x.fillStyle = colour;
        x.fillRect(i, y, 1, 1);
      }
      x.fillStyle = C.r4;
      x.fillRect(Math.ceil(mid - half) - 1, y, 1, 1);
      x.fillRect(Math.floor(mid + half), y, 1, 1);
    }
    x.fillStyle = C.r4;
    x.fillRect(mid - 1, 0, 2, 1);
    x.fillRect(0, height - 1, width, 1);
    return canvas;
  });
}

export interface RouteMapInput {
  slug: string;
  /** Her line in a 0–100 box (see normaliseRouteLine). */
  line: Array<[number, number]>;
  biome: Biome;
  coastal: boolean;
  /** Metres of climb per kilometre; 0 when the climb is unknown. */
  climbPerKm: number;
}

export interface RouteMap {
  frames: [HTMLCanvasElement, HTMLCanvasElement];
  points: Array<[number, number]>;
  cumulative: number[];
  total: number;
}

const routeMaps = new Map<string, RouteMap>();

/** Margins: top, right, bottom, left. */
export function routeMap(input: RouteMapInput, w: number, h: number, margins: [number, number, number, number]): RouteMap {
  const key = `${input.slug}|${w}x${h}|${margins.join(",")}`;
  const existing = routeMaps.get(key);
  if (existing) return existing;
  const seed = hash(input.slug);
  const style = BIOME_STYLES[input.biome];
  const sea = input.coastal;
  const [mt, mr, mb, ml] = margins;

  const xs = input.line.map(([x]) => x);
  const ys = input.line.map(([, y]) => y);
  const bx = Math.min(...xs);
  const by = Math.min(...ys);
  const bw = Math.max(1, Math.max(...xs) - bx);
  const bh = Math.max(1, Math.max(...ys) - by);
  const scale = Math.min((w - ml - mr) / bw, (h - mt - mb) / bh);
  const ox = ml + ((w - ml - mr) - bw * scale) / 2 - bx * scale;
  const oy = mt + ((h - mt - mb) - bh * scale) / 2 - by * scale;
  const points = input.line.map(([x, y]) => [x * scale + ox, y * scale + oy] as [number, number]);
  const cumulative = [0];
  for (let i = 1; i < points.length; i += 1) {
    cumulative.push(cumulative[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  }

  // Her path as a mask, then a chamfer distance field from it.
  const N = w * h;
  const mask = new Uint8Array(N);
  const dist = new Float32Array(N);
  for (let i = 1; i < points.length; i += 1) {
    const [ax, ay] = points[i - 1];
    const [bx2, by2] = points[i];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx2 - ax, by2 - ay) * 2));
    for (let s = 0; s <= steps; s += 1) {
      const px = Math.round(ax + ((bx2 - ax) * s) / steps);
      const py = Math.round(ay + ((by2 - ay) * s) / steps);
      if (px >= 0 && py >= 0 && px < w && py < h) mask[py * w + px] = 1;
    }
  }
  for (let i = 0; i < N; i += 1) dist[i] = mask[i] ? 0 : 1e6;
  const D1 = 1;
  const D2 = 1.414;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const k = y * w + x;
      let v = dist[k];
      if (x > 0) v = Math.min(v, dist[k - 1] + D1);
      if (y > 0) {
        v = Math.min(v, dist[k - w] + D1);
        if (x > 0) v = Math.min(v, dist[k - w - 1] + D2);
        if (x < w - 1) v = Math.min(v, dist[k - w + 1] + D2);
      }
      dist[k] = v;
    }
  }
  for (let y = h - 1; y >= 0; y -= 1) {
    for (let x = w - 1; x >= 0; x -= 1) {
      const k = y * w + x;
      let v = dist[k];
      if (x < w - 1) v = Math.min(v, dist[k + 1] + D1);
      if (y < h - 1) {
        v = Math.min(v, dist[k + w] + D1);
        if (x < w - 1) v = Math.min(v, dist[k + w + 1] + D2);
        if (x > 0) v = Math.min(v, dist[k + w - 1] + D2);
      }
      dist[k] = v;
    }
  }
  const clampIndex = (value: number, max: number) => Math.min(max, Math.max(0, Math.round(value)));
  const distanceAt = (x: number, y: number) => dist[clampIndex(y, h - 1) * w + clampIndex(x, w - 1)];

  const TW = Math.ceil(w / 8);
  const TH = Math.ceil(h / 8);
  const nE = fbm(seed + 1, 34);
  const nW = fbm(seed + 2, 30);
  const nT = fbm(seed + 3, 22);
  const nG = fbm(seed + 4, 14);
  const nR = fbm(seed + 5, 26);
  const nH = fbm(seed + 6, 20);
  const cr = input.climbPerKm;
  const levels = cr > 38 ? 3 : cr > 24 ? 2 : cr > 12 ? 1 : 0;

  // On the coast, the sea lies on the edge farthest from her path.
  let side = 0;
  if (sea) {
    let best = -1;
    [[0, 0.5], [1, 0.5], [0.5, 0], [0.5, 1]].forEach(([ex, ey], index) => {
      let sum = 0;
      let count = 0;
      for (let t = 0; t < points.length; t += 4) {
        sum += Math.hypot((points[t][0] - ex * w) / w, (points[t][1] - ey * h) / h);
        count += 1;
      }
      sum /= count;
      if (sum > best) {
        best = sum;
        side = index;
      }
    });
  }

  // Tile types: 0 ground, 1 water, 2 tall grass, 3 flowers, 4 crop, 5 reeds, 6 paving.
  const T = new Int8Array(TW * TH);
  const LV = new Int8Array(TW * TH);
  const TD = new Float32Array(TW * TH);
  for (let ty = 0; ty < TH; ty += 1) {
    for (let tx = 0; tx < TW; tx += 1) {
      const cx = tx * 8 + 4;
      const cy = ty * 8 + 4;
      const t = ty * TW + tx;
      const d = Math.min(distanceAt(cx, cy), distanceAt(tx * 8, ty * 8), distanceAt(tx * 8 + 7, ty * 8), distanceAt(tx * 8, ty * 8 + 7), distanceAt(tx * 8 + 7, ty * 8 + 7));
      TD[t] = d;
      LV[t] = levels ? Math.min(levels, Math.floor(nE(cx, cy) * (levels + 1.2))) : 0;
      let type = 0;
      if (sea) {
        const edge = side === 0 ? cx / w : side === 1 ? 1 - cx / w : side === 2 ? cy / h : 1 - cy / h;
        if (edge + (nW(cx, cy) - 0.5) * 0.32 < 0.2 && d > 7) type = 1;
      } else if (style.water === "pond" && nW(cx, cy) > 0.6 && d > 6) type = 1;
      else if (style.water === "lake" && nW(cx, cy) > 0.68 && d > 10) type = 1;
      else if (style.water === "river" && w > 80) {
        const ry = h * (0.22 + (0.56 * ((seed >>> 4) % 100)) / 100) + Math.sin((cx / w) * Math.PI * 2 * 1.3 + (seed % 7)) * h * 0.12;
        if (Math.abs(cy - ry) < 9 && d > 5) type = 1;
      }
      if (!type) {
        if (style.city && nT(cx, cy) < 0.52) type = 6;
        else if (style.crop && nG(cx, cy) > 0.58 && d > 3) type = 4;
        else if (style.reeds && nG(cx, cy) > 0.52 && d > 2) type = 5;
        else if (nG(cx, cy) > (style.city ? 0.68 : 0.62) && d > 3) type = 2;
        else if (hash(`${seed}f${t}`) % 100 < 4) type = 3;
      }
      T[t] = type;
    }
  }

  const frames = [0, 1].map((frame) => {
    const canvas = makeCanvas(w, h);
    const X = context2d(canvas);
    const G = style.ground;
    for (let ty = 0; ty < TH; ty += 1) {
      for (let tx = 0; tx < TW; tx += 1) {
        const t = ty * TW + tx;
        const type = T[t];
        const x0 = tx * 8;
        const y0 = ty * 8;
        let base: string = LV[t] >= 2 ? G[0] : G[1];
        let lite: string = G[0];
        let dark: string = G[2];
        if (type === 6) {
          base = C.pave;
          lite = "#ece9e1";
          dark = C.pave2;
        }
        X.fillStyle = base;
        X.fillRect(x0, y0, 8, 8);
        const hh = hash(`${seed}g${t}`);
        if (type === 6) {
          X.fillStyle = dark;
          X.fillRect(x0, y0 + 7, 8, 1);
          X.fillRect(x0 + 7, y0, 1, 8);
        } else if (type === 0 || type === 3) {
          X.fillStyle = dark;
          const ax = hh % 6;
          const ay = (hh >> 3) % 6;
          X.fillRect(x0 + ax, y0 + ay + 1, 1, 1);
          X.fillRect(x0 + ax + 2, y0 + ay + 1, 1, 1);
          X.fillRect(x0 + ax + 1, y0 + ay, 1, 1);
          if (hh % 3 === 0) {
            X.fillStyle = lite;
            X.fillRect(x0 + ((hh >> 6) % 7), y0 + ((hh >> 9) % 7), 1, 1);
          }
        }
        if (type === 1) drawWaterTile(X, x0, y0, tx, ty, frame, T, TW, TH, base);
        if (type === 2) {
          const tall = style.treeColour === "maple" ? ["#2f6b3e", "#4f9a4c", "#9fd27a"] : ["#2f6b3e", "#4b9449", "#97cf73"];
          X.fillStyle = tall[1];
          X.fillRect(x0, y0, 8, 8);
          X.fillStyle = tall[0];
          for (let q = 0; q < 2; q += 1) {
            const yy = y0 + q * 4;
            X.fillRect(x0 + 1, yy + 1, 1, 3);
            X.fillRect(x0 + 5, yy + 1, 1, 3);
            X.fillRect(x0, yy + 3, 3, 1);
            X.fillRect(x0 + 4, yy + 3, 3, 1);
          }
          X.fillStyle = tall[2];
          for (let q = 0; q < 2; q += 1) {
            const yy = y0 + q * 4;
            X.fillRect(x0 + 2, yy, 1, 2);
            X.fillRect(x0 + 6, yy, 1, 2);
          }
        }
        if (type === 3) {
          X.fillStyle = [C.fl1, C.fl2, C.fl3][hh % 3];
          for (const [fx, fy] of [[2, 2], [1, 3], [3, 3], [2, 4], [5, 5], [4, 6], [6, 6]]) X.fillRect(x0 + fx, y0 + fy, 1, 1);
          X.fillStyle = C.fl2;
          X.fillRect(x0 + 2, y0 + 3, 1, 1);
          X.fillRect(x0 + 5, y0 + 6, 1, 1);
        }
        if (type === 4) {
          const prairie = input.biome === "prairie";
          X.fillStyle = prairie ? "#e6c565" : "#8fbf5d";
          X.fillRect(x0, y0, 8, 8);
          X.fillStyle = prairie ? "#c79e45" : "#5f9548";
          X.fillRect(x0, y0 + 1, 8, 1);
          X.fillRect(x0, y0 + 5, 8, 1);
          X.fillStyle = prairie ? "#f5df8c" : "#b2d97a";
          X.fillRect(x0, y0 + 3, 8, 1);
          X.fillRect(x0, y0 + 7, 8, 1);
        }
        if (type === 5) {
          X.fillStyle = "#5f8f4f";
          X.fillRect(x0 + 1, y0 + 2, 1, 5);
          X.fillRect(x0 + 4, y0 + 1, 1, 6);
          X.fillRect(x0 + 6, y0 + 3, 1, 4);
          X.fillStyle = "#8a5a3b";
          X.fillRect(x0 + 4, y0, 1, 2);
          X.fillRect(x0 + 1, y0 + 1, 1, 2);
        }
      }
    }
    // Ledges where the ground steps down, more of them for a steeper route.
    for (let ty = 0; ty < TH; ty += 1) {
      for (let tx = 0; tx < TW; tx += 1) {
        const t = ty * TW + tx;
        if (T[t] === 1 || T[t] === 6) continue;
        if (ty + 1 < TH && LV[t + TW] < LV[t] && T[t + TW] !== 1 && TD[t] > 5 && TD[t + TW] > 5) {
          const x0 = tx * 8;
          const y0 = ty * 8;
          X.fillStyle = G[2];
          X.fillRect(x0, y0 + 5, 8, 1);
          X.fillStyle = C.g5;
          X.fillRect(x0, y0 + 6, 8, 1);
          X.fillStyle = "rgba(20,40,30,.22)";
          X.fillRect(x0, y0 + 7, 8, 1);
          X.fillStyle = G[0];
          X.fillRect(x0, y0 + 4, 8, 1);
        }
      }
    }
    // Her line, worn into the ground.
    const pathColours = style.city
      ? ["#f7f4ea", "#b6b0a2"]
      : input.biome === "volc"
        ? ["#f3e2b0", "#b99a62"]
        : input.biome === "prairie" || input.biome === "calif"
          ? ["#f3e4b6", "#b8975c"]
          : ["#eed9a5", "#bf9c62"];
    X.fillStyle = pathColours[1];
    for (let i = 0; i < N; i += 1) if (dist[i] <= 2.3) X.fillRect(i % w, Math.floor(i / w), 1, 1);
    X.fillStyle = pathColours[0];
    for (let i = 0; i < N; i += 1) if (dist[i] <= 1.3) X.fillRect(i % w, Math.floor(i / w), 1, 1);

    // Features on 16-pixel tiles, drawn back to front.
    const features: Array<{ y: number; draw: () => void }> = [];
    let village = 0;
    for (let my = 0; my < Math.ceil(h / 16); my += 1) {
      for (let mx = 0; mx < Math.ceil(w / 16); mx += 1) {
        const X0 = mx * 16;
        const Y0 = my * 16;
        let ok = true;
        let nearest = 1e9;
        for (let dy = 0; dy < 2; dy += 1) {
          for (let dx = 0; dx < 2; dx += 1) {
            const tx = mx * 2 + dx;
            const ty = my * 2 + dy;
            if (tx >= TW || ty >= TH) {
              ok = false;
              continue;
            }
            const tt = ty * TW + tx;
            if (T[tt] === 1) ok = false;
            nearest = Math.min(nearest, TD[tt]);
          }
        }
        if (!ok || nearest < 5) continue;
        const cx = X0 + 8;
        const cy = Y0 + 8;
        const hv = (hash(`${seed}m${mx},${my}`) % 1000) / 1000;
        const roof = hv < 0.33 ? "blue" : hv < 0.66 ? "red" : "green";
        if (style.city && nH(cx, cy) > 0.5 && nearest > 5) {
          features.push({ y: Y0, draw: () => X.drawImage(houseSprite(hv < 0.5 ? "block" : "house", roof), X0, Y0) });
          continue;
        }
        const fromStart = Math.hypot(cx - points[0][0], cy - points[0][1]);
        if (!style.city && w > 80 && fromStart < 36 && nearest > 6 && hv < 0.55 && village < 4) {
          village += 1;
          const villageRoof = hv < 0.2 ? "blue" : hv < 0.4 ? "red" : "green";
          features.push({ y: Y0, draw: () => X.drawImage(houseSprite("house", villageRoof), X0, Y0) });
          continue;
        }
        if (style.rock && nR(cx, cy) > 0.72 - style.rock * 0.3 - Math.min(0.12, cr / 400) && nearest > 8) {
          const peak = style.snow || cr > 30;
          features.push({ y: Y0, draw: () => (peak ? X.drawImage(mountain(16, 14, Boolean(style.snow)), X0, Y0 + 1) : X.drawImage(rockSprite(), X0, Y0)) });
          continue;
        }
        const edgeBias = Math.max(0, 1 - Math.min(cx, w - cx, cy, h - cy) / 26) * 0.3;
        if (nT(cx, cy) + edgeBias > (style.city ? 0.6 : 0.5) + 0.04 && nearest > 6) {
          const kind = style.trees[hash(`${seed}k${mx}${my}`) % 3];
          const colour = style.treeColour === "maple" && hash(`${X0},${Y0}`) % 3 === 0 ? "maple2" : style.treeColour;
          features.push({ y: Y0, draw: () => X.drawImage(treeSprite(kind, colour), X0, Y0) });
        }
      }
    }
    features.sort((a, b) => a.y - b.y).forEach((feature) => feature.draw());

    // A signpost at the start.
    const [spx, spy] = points[0];
    let sx = Math.round(spx + 5);
    let sy = Math.round(spy - 12);
    if (sx > w - 10) sx = Math.round(spx - 14);
    if (sy < 2) sy = Math.round(spy + 4);
    X.fillStyle = C.t2;
    X.fillRect(sx + 3, sy + 5, 2, 6);
    X.fillStyle = C.ink;
    X.fillRect(sx, sy, 8, 6);
    X.fillStyle = C.wall;
    X.fillRect(sx + 1, sy + 1, 6, 4);
    X.fillStyle = C.t1;
    X.fillRect(sx + 2, sy + 2, 4, 1);
    X.fillRect(sx + 2, sy + 3, 3, 1);
    return canvas;
  }) as [HTMLCanvasElement, HTMLCanvasElement];

  const map = { frames, points, cumulative, total: cumulative[cumulative.length - 1] };
  routeMaps.set(key, map);
  return map;
}

function drawWaterTile(
  X: Ctx,
  x0: number,
  y0: number,
  tx: number,
  ty: number,
  frame: number,
  T: Int8Array,
  TW: number,
  TH: number,
  base: string,
) {
  X.fillStyle = C.w2;
  X.fillRect(x0, y0, 8, 8);
  X.fillStyle = C.w1;
  const o = frame ? 2 : 0;
  if ((tx + ty) % 2 === 0) {
    X.fillRect(x0 + ((1 + o) % 8), y0 + 2, 2, 1);
    X.fillRect(x0 + ((3 + o) % 8), y0 + 3, 1, 1);
    X.fillRect(x0 + (o % 8), y0 + 3, 1, 1);
  } else {
    X.fillRect(x0 + ((4 + o) % 8), y0 + 5, 2, 1);
    X.fillRect(x0 + ((6 + o) % 8), y0 + 6, 1, 1);
    X.fillRect(x0 + ((3 + o) % 8), y0 + 6, 1, 1);
  }
  const isWater = (ax: number, ay: number) => ax < 0 || ay < 0 || ax >= TW || ay >= TH || T[ay * TW + ax] === 1;
  X.fillStyle = C.w0;
  if (!isWater(tx, ty - 1)) X.fillRect(x0, y0, 8, 1);
  if (!isWater(tx + 1, ty)) X.fillRect(x0 + 7, y0, 1, 8);
  if (!isWater(tx, ty + 1)) X.fillRect(x0, y0 + 7, 8, 1);
  if (!isWater(tx - 1, ty)) X.fillRect(x0, y0, 1, 8);
  for (const [dx, dy, cx, cy] of [[-1, -1, 0, 0], [1, -1, 6, 0], [-1, 1, 0, 6], [1, 1, 6, 6]]) {
    if (isWater(tx + dx, ty) || isWater(tx, ty + dy)) continue;
    const ax = x0 + cx;
    const ay = y0 + cy;
    X.fillStyle = base;
    X.fillRect(ax + (dx < 0 ? 0 : 1), ay + (dy < 0 ? 0 : 1), 1, 1);
    X.fillRect(ax + (dx < 0 ? 1 : 0), ay + (dy < 0 ? 0 : 1), 1, 1);
    X.fillRect(ax + (dx < 0 ? 0 : 1), ay + (dy < 0 ? 1 : 0), 1, 1);
    X.fillStyle = C.w0;
    X.fillRect(ax + (dx < 0 ? 1 : 0), ay + (dy < 0 ? 1 : 0), 1, 1);
  }
}
