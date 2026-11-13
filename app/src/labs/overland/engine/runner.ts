// The runner from the approved diorama: 16 × 24 pixels, four frames each
// facing down (towards the viewer), up (away), right and left. The town
// draws her from an atlas; the 3D world shows the same frames, so she is
// the same sprite on both sides of the jump.

import { context2d, makeCanvas } from "@/labs/overland/engine/canvas";

export const RUNNER_FRAME = { width: 16, height: 24 } as const;
export type RunnerFacing = "down" | "up" | "right" | "left";
export const RUNNER_ROWS: Record<RunnerFacing, number> = { down: 0, up: 1, right: 2, left: 3 };

const PALETTE: Record<string, string> = {
  h: "#5b3424",
  H: "#86522f",
  w: "#ffffff",
  W: "#d4d9e2",
  s: "#f3c6a2",
  S: "#d69c7a",
  r: "#e8503a",
  R: "#a8331f",
  n: "#2e3d6b",
  N: "#1e2a4c",
  o: "#f6f6f2",
  O: "#8e97ab",
  k: "#1d2433",
};

function frame(direction: "D" | "U" | "R", f: number) {
  const grid: Array<Array<string | null>> = Array.from({ length: 24 }, () => Array<string | null>(16).fill(null));
  const P = (x: number, y: number, c: string) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < 16 && y < 24) grid[y][x] = c;
  };
  const Rc = (x: number, y: number, w: number, h: number, c: string) => {
    for (let j = 0; j < h; j += 1) for (let i = 0; i < w; i += 1) P(x + i, y + j, c);
  };
  const Ln = (x0: number, y0: number, x1: number, y1: number, w: number, c: string) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let t = 0; t <= n; t += 1) Rc(Math.round(x0 + ((x1 - x0) * t) / n), Math.round(y0 + ((y1 - y0) * t) / n), w, 1, c);
  };
  const b = f % 2 === 1 ? -1 : 0;
  if (direction === "D" || direction === "U") {
    const legS = (x: number) => {
      Rc(x, 17 + b, 2, 4, "s");
      Rc(x, 21 + b, 2, 1, "w");
      Rc(x - (x < 8 ? 1 : 0), 22 + b, 3, 1, "o");
      Rc(x - (x < 8 ? 1 : 0), 23 + b, 3, 1, "O");
    };
    const legB = (x: number) => {
      Rc(x, 17 + b, 2, 2, "s");
      Rc(x - (x < 8 ? 1 : 0), 19 + b, 3, 1, "o");
      Rc(x - (x < 8 ? 1 : 0), 20 + b, 3, 1, "O");
    };
    if (f === 0) {
      legS(5);
      legB(9);
    } else if (f === 2) {
      legB(5);
      legS(9);
    } else {
      Rc(5, 17 + b, 2, 3, "s");
      Rc(9, 17 + b, 2, 3, "s");
      Rc(4, 20 + b, 3, 1, "o");
      Rc(9, 20 + b, 3, 1, "o");
      Rc(4, 21 + b, 3, 1, "O");
      Rc(9, 21 + b, 3, 1, "O");
    }
    Rc(4, 15 + b, 8, 2, "n");
    Rc(10, 15 + b, 2, 2, "N");
    P(7, 16 + b, "N");
    P(8, 16 + b, "N");
    Rc(4, 10 + b, 8, 5, "r");
    Rc(10, 10 + b, 2, 5, "R");
    if (direction === "D") Rc(6, 10 + b, 4, 1, "s");
    const la = f === 0 ? 3 : f === 2 ? 5 : 4;
    const ra = f === 0 ? 5 : f === 2 ? 3 : 4;
    Rc(2, 10 + b, 2, la, "s");
    Rc(12, 10 + b, 2, ra, "s");
    Rc(2, 10 + b, 2, 1, "r");
    Rc(12, 10 + b, 2, 1, "r");
    Rc(4, 1 + b, 8, 3, "h");
    P(6, 2 + b, "H");
    P(7, 2 + b, "H");
    P(5, 1 + b, "H");
    Rc(4, 4 + b, 8, 1, "w");
    P(11, 4 + b, "W");
    if (direction === "D") {
      Rc(4, 5 + b, 8, 4, "s");
      P(4, 5 + b, "h");
      P(11, 5 + b, "h");
      P(4, 6 + b, "h");
      P(11, 6 + b, "h");
      P(6, 7 + b, "k");
      P(9, 7 + b, "k");
      P(5, 8 + b, "S");
      P(10, 8 + b, "S");
      Rc(5, 9 + b, 6, 1, "s");
    } else {
      Rc(4, 5 + b, 8, 4, "h");
      Rc(5, 9 + b, 6, 1, "h");
      P(7, 6 + b, "H");
      P(8, 7 + b, "H");
      const px = 7 + (f === 1 ? -1 : f === 3 ? 1 : 0);
      Rc(px, 9 + b, 2, 3, "h");
      P(px, 10 + b, "H");
      Rc(px, 12 + b, 2, 1, "h");
    }
  } else {
    const poses: Array<[[number, number], [number, number]]> = [
      [[10, 19], [12, 21]],
      [[9, 19], [8, 21]],
      [[6, 19], [3, 20]],
      [[7, 18], [5, 18]],
    ];
    const leg = (knee: [number, number], foot: [number, number], c: string) => {
      Ln(8, 16 + b, knee[0], knee[1] + b, 2, c);
      Ln(knee[0], knee[1] + b, foot[0], foot[1] + b, 2, c);
      Rc(foot[0] - 1, foot[1] + b + 1, 3, 1, "o");
      Rc(foot[0] - 1, foot[1] + b + 2, 3, 1, "O");
    };
    const A0 = poses[f];
    const B0 = poses[(f + 2) % 4];
    leg(B0[0], B0[1], "S");
    const armF: [[number, number], [number, number]] = f === 0 || f === 3 ? [[10, 13], [12, 11]] : [[6, 13], [5, 11]];
    const armN: [[number, number], [number, number]] = f === 0 || f === 3 ? [[6, 13], [5, 11]] : [[10, 13], [12, 11]];
    Ln(8, 10 + b, armF[0][0], armF[0][1] + b, 2, "S");
    Ln(armF[0][0], armF[0][1] + b, armF[1][0], armF[1][1] + b, 2, "S");
    Rc(6, 9 + b, 5, 5, "r");
    Rc(6, 9 + b, 1, 5, "R");
    Rc(6, 14 + b, 5, 2, "n");
    Rc(6, 15 + b, 2, 1, "N");
    leg(A0[0], A0[1], "s");
    Rc(5, 1 + b, 6, 3, "h");
    P(7, 1 + b, "H");
    P(8, 2 + b, "H");
    Rc(5, 4 + b, 7, 1, "w");
    Rc(5, 5 + b, 3, 4, "h");
    Rc(8, 5 + b, 4, 4, "s");
    P(10, 6 + b, "k");
    P(12, 6 + b, "s");
    P(9, 8 + b, "S");
    const pt = f % 2 === 0 ? 0 : 1;
    Rc(2, 3 + b + pt, 3, 2, "h");
    P(1, 4 + b + pt, "h");
    P(3, 3 + b + pt, "H");
    P(4, 4 + b, "w");
    Ln(8, 10 + b, armN[0][0], armN[0][1] + b, 2, "s");
    Ln(armN[0][0], armN[0][1] + b, armN[1][0], armN[1][1] + b, 2, "s");
    Rc(7, 9 + b, 2, 1, "r");
  }
  const canvas = makeCanvas(16, 24);
  const context = context2d(canvas);
  for (let y = 0; y < 24; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      let key = grid[y][x];
      if (!key && ((x > 0 && grid[y][x - 1]) || (x < 15 && grid[y][x + 1]) || (y > 0 && grid[y - 1][x]) || (y < 23 && grid[y + 1][x]))) key = "k";
      if (!key) continue;
      context.fillStyle = PALETTE[key];
      context.fillRect(x, y, 1, 1);
    }
  }
  return canvas;
}

let atlas: HTMLCanvasElement | undefined;

/** A 64 × 96 atlas: rows down, up, right, left; four frames across. */
export function runnerAtlas() {
  if (atlas) return atlas;
  atlas = makeCanvas(64, 96);
  const context = context2d(atlas);
  (["D", "U", "R"] as const).forEach((direction, row) => {
    for (let f = 0; f < 4; f += 1) {
      const cell = frame(direction, f);
      context.drawImage(cell, f * 16, row * 24);
      if (direction === "R") {
        context.save();
        context.translate(f * 16 + 16, 3 * 24);
        context.scale(-1, 1);
        context.drawImage(cell, 0, 0);
        context.restore();
      }
    }
  });
  return atlas;
}

/** One frame of the runner, scaled up whole-pixel, as a canvas. */
export function runnerFrame(facing: RunnerFacing, index: number, scale: number) {
  const canvas = makeCanvas(16 * scale, 24 * scale);
  const context = context2d(canvas);
  context.drawImage(runnerAtlas(), (index % 4) * 16, RUNNER_ROWS[facing] * 24, 16, 24, 0, 0, 16 * scale, 24 * scale);
  return canvas;
}
