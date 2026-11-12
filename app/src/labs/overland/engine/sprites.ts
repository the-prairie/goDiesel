// Original sprites: the runner, the rider, interface icons and towns.

import { context2d, flipH, makeCanvas, sprite } from "@/labs/overland/engine/canvas";
import { C } from "@/labs/overland/engine/palette";

type Frames = HTMLCanvasElement[];
export interface Walker {
  down: Frames;
  up: Frames;
  right: Frames;
  left: Frames;
}

let cache: {
  run: Walker;
  ride: Walker;
  shadow: HTMLCanvasElement;
  icons: Record<"cursor" | "down" | "shoe" | "wheel" | "star" | "left" | "right", HTMLCanvasElement>;
} | undefined;

const PERSON: Record<string, string> = {
  k: C.ink, h: C.hair, H: C.hair2, s: C.skin, S: C.skin2, a: C.acc, A: C.acc2,
  n: C.shorts, N: C.shorts2, w: C.sock, e: C.ink, b: "#ffffff", g: "#59637a", G: "#9aa3b8", m: "#d9dde6",
};

const HEAD = ["................", ".....kkkkkk.....", "....khhhhhhk....", "...khhhhhhhhk...", "...kwwwwwwwwk...", "...khhsssshhk...", "...khsssssshk...", "...kskssssksk...", "....kssssssk...."];
const BACK = ["................", ".....kkkkkk.....", "....khhhhhhk....", "...khhhhhhhhk...", "...kwwwwwwwwk...", "...khhhhhhhhk...", "...khhhhhhhhk...", "...khhhHHhhhk...", "....khhHHhhk...."];
const TORSO_DOWN = ["...kaaassaaak...", "..ksaaaaaaaask..", "..ksAaaaaaaAsk..", "..kSknnnnnnkSk.."];
const TORSO_UP = ["...kaaahhaaak...", "..ksaaaHHaaask..", "..ksAaaaaaaAsk..", "..kSknnnnnnkSk.."];
const LEGS_STAND = ["....knnkknnk....", "....ksk..ksk....", "....kwk..kwk...."];
const LEGS_STEP = ["....knnkknnk....", "....ksk..kwk....", "....kwk..kkk...."];
const ARM_SWING = ["...kaaassaaak...", "..ksaaaaaaaak...", "..ksAaaaaaaAkk..", "..kSknnnnnnkSk.."];
const RUN_SIDE = [
  ["................", "......kkkkk.....", ".....khhhhhk....", "....khhhhhhhk...", "..kkkwwwwwwwk...", ".khhkhhhhssssk..", ".kHkkhhhsssksk..", "..k.khhssssssk..", ".....khsssssk...", ".....kkaaaak....", "....kaaaaaask...", "....kaAaaaSsk...", "....kknnnnk.....", "...knnk.kssk....", "..kssk...kssk...", "..kwk.....kwk..."],
  ["................", "................", "......kkkkk.....", ".....khhhhhk....", "..kkkhhhhhhhk...", ".khhkwwwwwwwk...", ".kHkkhhhhssssk..", "..k.khhhsssksk..", "....khhssssssk..", ".....kkaaaakk...", "....kaaaaaaak...", "....kaAaaasSk...", "....knnnnnnk....", ".....knk.ksk....", ".....ksk.kwk....", ".....kwk........"],
  ["................", "......kkkkk.....", ".....khhhhhk....", "....khhhhhhhk...", "..kkkwwwwwwwk...", ".khhkhhhhssssk..", ".kHkkhhhsssksk..", "..k.khhssssssk..", ".....khsssssk...", ".....kkaaaak....", "....ksaaaaaak...", "....kSaaaAaak...", ".....knnnnkk....", "....kssk.knnk...", "...kssk...kssk..", "...kwk.....kwk.."],
  ["................", "................", "......kkkkk.....", ".....khhhhhk....", "..kkkhhhhhhhk...", ".khhkwwwwwwwk...", ".kHkkhhhhssssk..", "..k.khhhsssksk..", "....khhssssssk..", ".....kkaaaakk...", "....kaaaaaaak...", "....kaAaaasSk...", "....knnnnnnk....", ".....ksk.knk....", ".....kwk.ksk....", ".........kwk...."],
];
const RIDE_DOWN = [...HEAD, "...kaaassaaak...", ".kgkSaaaaaaSkgk.", ".kkkkkaaaakkkkk.", "...knnkkknnk....", "...ksk.kgk.ksk..", "...kwk.kgk.kwk..", ".......kgk......"];
const RIDE_DOWN_STEP = [...HEAD, "...kaaassaaak...", ".kgkSaaaaaaSkgk.", ".kkkkkaaaakkkkk.", "...knnkkknnk....", "...ksk.kgk.kwk..", "...kwk.kgk......", ".......kgk......"];
const RIDE_UP = [...BACK, "...kaaahhaaak...", ".kgkSaaHHaaSkgk.", ".kkkkkaaaakkkkk.", "...knnkkknnk....", "...ksk.kgk.ksk..", "...kwk.kgk.kwk..", ".......kgk......"];
// The rider's upper body in profile; the bicycle under it is drawn below.
const RIDER_SIDE = ["................", ".......kkkk.....", "......khhhhk....", "..kkkkwwwwwwk...", ".khhkhhhhsssk...", ".kHk.khhssksk...", "..k...khssssk...", "......kaaakk....", ".....kaaaaask...", "....kaAaaakSkk.."];

/** The side-on bicycle: two wheels, a diamond frame, and pedalling legs. */
function bicycleSide(frame: 0 | 1) {
  const grid = Array.from({ length: 16 }, (_, y) => (y < RIDER_SIDE.length ? RIDER_SIDE[y] : "................").split(""));
  const put = (x: number, y: number, c: string) => {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px >= 0 && py >= 0 && px < 16 && py < 16) grid[py][px] = c;
  };
  const line = (x0: number, y0: number, x1: number, y1: number, c: string) => {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= steps; i += 1) put(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, c);
  };
  for (let y = 10; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      for (const [cx, cy] of [[3, 12.5], [12.5, 12.5]]) {
        if (Math.abs(Math.hypot(x - cx, y - cy) - 2.6) < 0.62) grid[y][x] = "k";
      }
    }
  }
  line(3, 12, 7, 12, "A");
  line(7, 12, 6, 9, "A");
  line(6, 9, 11, 9, "A");
  line(11, 9, 12, 12, "A");
  line(7, 12, 11, 9, "A");
  put(3, 12, "g");
  put(12, 12, "g");
  put(12, 8, "k");
  put(13, 8, "k");
  if (frame) {
    put(7, 10, "n"); put(6, 11, "s"); put(5, 12, "w"); put(6, 12, "w");
  } else {
    put(7, 10, "n"); put(8, 10, "n"); put(8, 11, "s"); put(8, 13, "w"); put(9, 13, "w");
  }
  return grid.map((row) => row.join(""));
}

function build() {
  const p = (rows: string[]) => sprite(rows, PERSON);
  const down = [p([...HEAD, ...TORSO_DOWN, ...LEGS_STAND]), p([...HEAD, ...ARM_SWING, ...LEGS_STEP])];
  const upStep = [...BACK, "...kaaahhaaak...", "..ksaaaHHaaak...", "..ksAaaaaaaAkk..", "..kSknnnnnnkSk..", ...LEGS_STEP];
  const up = [p([...BACK, ...TORSO_UP, ...LEGS_STAND]), p(upStep)];
  const runRight = RUN_SIDE.map(p);
  const run: Walker = {
    down: [down[0], down[1], down[0], flipH(down[1])],
    up: [up[0], up[1], up[0], flipH(up[1])],
    right: runRight,
    left: runRight.map(flipH),
  };
  const rideRight = [0, 1, 0, 1].map((frame) => p(bicycleSide(frame as 0 | 1)));
  const rideDown = [p(RIDE_DOWN), p(RIDE_DOWN_STEP)];
  const rideUp = p(RIDE_UP);
  const ride: Walker = {
    down: [rideDown[0], rideDown[1], rideDown[0], flipH(rideDown[1])],
    up: [rideUp, flipH(rideUp), rideUp, flipH(rideUp)],
    right: rideRight,
    left: rideRight.map(flipH),
  };
  const left = sprite(["...kk", "..kkk", ".kkkk", "kkkkk", ".kkkk", "..kkk", "...kk"], { k: C.ink });
  const icons = {
    cursor: sprite(["k....", "kak..", "kaak.", "kaaak", "kaak.", "kak..", "k...."], { k: C.ink, a: C.acc }),
    down: sprite(["kkkkkkk", ".kaaak.", "..kak..", "...k..."], { k: C.ink, a: C.acc }),
    shoe: sprite(["..kk....", "..kak...", "..kaakk.", "kkkaaaak", "kwwwwwwk", ".kkkkkk."], { k: C.ink, a: C.acc, w: "#ffffff" }),
    wheel: sprite(["..kkk..", ".k...k.", "k..k..k", "k.kkk.k", "k..k..k", ".k...k.", "..kkk.."], { k: C.ink }),
    star: sprite(["...k...", "..kak..", "kkkaakk", "kaaaaak", ".kaaak.", ".kakak.", ".k...k."], { k: C.ink, a: C.acc }),
    left,
    right: flipH(left),
  };
  const shadow = sprite(["..kkkkkkkkkk..", "kkkkkkkkkkkkkk", "..kkkkkkkkkk.."], { k: "rgba(20,30,40,.22)" });
  return { run, ride, shadow, icons };
}

export function sprites() {
  cache ??= build();
  return cache;
}

const townIcons = new Map<number, HTMLCanvasElement>();

/** One, two or three houses, by how many routes a town holds. */
export function townIcon(routeCount: number) {
  const size = routeCount >= 4 ? 3 : routeCount >= 2 ? 2 : 1;
  const cached = townIcons.get(size);
  if (cached) return cached;
  const hut = ["...oo...", "..orro..", ".orrrro.", "oRRRRRRo", ".owwwwo.", ".owDwwo.", ".oooooo."];
  const red = sprite(hut, { o: C.ink, r: C.rf, R: C.rf2, w: C.wall, D: C.t2 });
  const blue = sprite(hut, { o: C.ink, r: C.rb, R: C.rb2, w: C.wall, D: C.t2 });
  const canvas = makeCanvas(14, 11);
  const context = context2d(canvas);
  if (size === 1) context.drawImage(red, 3, 4);
  else if (size === 2) {
    context.drawImage(blue, 0, 4);
    context.drawImage(red, 6, 3);
  } else {
    context.drawImage(blue, 0, 4);
    context.drawImage(red, 6, 4);
    context.drawImage(red, 3, 0);
  }
  townIcons.set(size, canvas);
  return canvas;
}
