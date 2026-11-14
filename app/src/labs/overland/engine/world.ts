// The world map: land and biome masks decoded, then painted as pixel
// terrain with surf, beaches, forests, deserts, snow and peaks. Two frames,
// so the open sea can shimmer.

import { context2d, makeCanvas, sprite } from "@/labs/overland/engine/canvas";
import { hash } from "@/labs/overland/engine/noise";
import { C } from "@/labs/overland/engine/palette";
import { BIOME_RUNS, LAND_RUNS } from "@/labs/overland/engine/world-mask";
import { WORLD_MAP } from "@/labs/overland/model/overland-towns";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const W = WORLD_MAP.width;
const H = WORLD_MAP.height;

function decodeWorld() {
  const land = new Uint8Array(W * H);
  let i = 0;
  let k = 0;
  const read = (source: string) => {
    const c = ALPHABET.indexOf(source.charAt(i++));
    return c < 32 ? c : ((c - 32) << 6) + ALPHABET.indexOf(source.charAt(i++));
  };
  for (let row = 0; row < H; row += 1) {
    let current = 0;
    let filled = 0;
    while (filled < W && i < LAND_RUNS.length) {
      const run = read(LAND_RUNS);
      for (let j = 0; j < run && filled < W; j += 1) {
        land[k++] = current;
        filled += 1;
      }
      current ^= 1;
    }
  }
  const biomeWidth = W / 2;
  const biome = new Uint8Array(biomeWidth * (H / 2));
  i = 0;
  k = 0;
  while (i < BIOME_RUNS.length && k < biome.length) {
    const kind = ALPHABET.indexOf(BIOME_RUNS.charAt(i++));
    const run = read(BIOME_RUNS) + 1;
    for (let j = 0; j < run && k < biome.length; j += 1) biome[k++] = kind;
  }
  return { land, biome };
}

function rgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

let baked: HTMLCanvasElement[] | undefined;

/** The two frames of the 1100 × 288 world map, painted once per page. */
export function worldFrames() {
  if (baked) return baked;
  const { land: L, biome: B } = decodeWorld();
  const land = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : L[y * W + x]);
  const biome = (x: number, y: number) => B[(y >> 1) * (W / 2) + (x >> 1)];
  // Distance from each sea cell to the nearest land, up to four, for surf.
  const toLand = new Uint8Array(W * H);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (land(x, y)) continue;
      let distance = 9;
      for (let r = 1; r <= 4 && distance === 9; r += 1) {
        for (let a = -r; a <= r && distance === 9; a += 1) {
          if (land(x + a, y - r) || land(x + a, y + r) || land(x - r, y + a) || land(x + r, y + a)) distance = r;
        }
      }
      toLand[y * W + x] = distance;
    }
  }
  const water = [rgb(C.w4), rgb(C.w3), rgb(C.w2), rgb(C.w1), rgb(C.w0)];
  const grass = [rgb("#bfe28c"), rgb("#93cb6b"), rgb("#6aa956")];
  const sand = [rgb("#f2dc9e"), rgb("#e2c47c")];
  const snow = [rgb("#ffffff"), rgb("#dfe9f5")];
  const rock = [rgb("#d9cfbf"), rgb("#a99c8b")];
  const beach = rgb("#f6e6b2");
  const tree = sprite([".ll.", "lmmd", "mmdd", ".dd."], { l: "#a9d978", m: "#5f9e55", d: "#2f6b3e" });
  const peak = sprite(["..o..", ".lho.", ".lmdo", "lmmdd"], { o: "#5a5049", l: "#ffffff", h: "#dfe9f5", m: "#d9cfbf", d: "#a99c8b" });

  baked = [0, 1].map((frame) => {
    const canvas = makeCanvas(W, H);
    const context = context2d(canvas);
    const image = context.createImageData(W, H);
    const pixels = image.data;
    const put = (x: number, y: number, colour: [number, number, number]) => {
      const k = (y * W + x) * 4;
      pixels[k] = colour[0];
      pixels[k + 1] = colour[1];
      pixels[k + 2] = colour[2];
      pixels[k + 3] = 255;
    };
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        if (!land(x, y)) {
          const d = toLand[y * W + x];
          let colour = d === 1 ? water[4] : d <= 2 ? water[3] : d <= 4 ? water[2] : water[1];
          if (d === 3 && (x + y) % 2) colour = water[2];
          if (d === 9) {
            colour = water[1];
            const gx = (x + (frame ? 1 : 0) + (Math.floor(y / 6) % 2) * 6) % 12;
            const gy = y % 6;
            if (gy === 2 && (gx === 3 || gx === 4)) colour = water[2];
            if (gy === 1 && gx === 5) colour = water[2];
          }
          put(x, y, colour);
          continue;
        }
        const coast = !land(x - 1, y) || !land(x + 1, y) || !land(x, y - 1) || !land(x, y + 1);
        const kind = biome(x, y);
        const h = hash(`${x * 7},${y}`) % 100;
        if (coast && kind !== 3) put(x, y, beach);
        else if (kind === 0) put(x, y, h < 8 ? grass[2] : h < 14 ? grass[0] : grass[1]);
        else if (kind === 1) put(x, y, grass[2]);
        else if (kind === 2) put(x, y, h < 10 ? sand[1] : sand[0]);
        else if (kind === 3) put(x, y, h < 20 ? snow[1] : snow[0]);
        else put(x, y, h < 12 ? rock[1] : rock[0]);
      }
    }
    context.putImageData(image, 0, 0);
    for (let y = 2; y < H - 4; y += 4) {
      for (let x = ((y / 4) % 2) * 2; x < W - 4; x += 4) {
        if (!land(x + 1, y + 1) || !land(x + 3, y + 3) || !land(x, y) || !land(x + 3, y)) continue;
        if (biome(x + 2, y + 2) === 1 && hash(`t${x},${y}`) % 10 < 8) context.drawImage(tree, x, y);
      }
    }
    for (let y = 2; y < H - 5; y += 5) {
      for (let x = ((y / 5) % 2) * 3; x < W - 6; x += 6) {
        if (biome(x + 2, y + 2) === 4 && land(x, y) && land(x + 4, y + 3) && hash(`m${x},${y}`) % 10 < 7) {
          context.drawImage(peak, x, y);
        }
      }
    }
    return canvas;
  });
  return baked;
}
