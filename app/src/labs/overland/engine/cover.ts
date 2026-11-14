// The jump's cover: the route's own pixel map at the size of the screen,
// with the runner or rider at the start. It is our art over the live map,
// cleared in dithered blocks; Google's map underneath is never touched.

import type { Ctx } from "@/labs/overland/engine/canvas";
import { routeMap, type RouteMap, type RouteMapInput } from "@/labs/overland/engine/route-map";
import { sprites } from "@/labs/overland/engine/sprites";
import { cellCovered, type PixelRect } from "@/labs/overland/model/dither-wipe";

export function coverMap(input: RouteMapInput, width: number, height: number): RouteMap {
  const x = Math.round(width * 0.12);
  const y = Math.round(height * 0.16);
  return routeMap(input, width, height, [y, x, y, x]);
}

export interface CoverFrame {
  map: RouteMap;
  kind: "run" | "ride";
  /** How much of the cover is drawn, from 1 (all) to 0 (clear). */
  coverage: number;
  /** Cover pixels per block of the wipe. */
  cell: number;
  /** Cover pixels to leave clear: the attribution corners, while the map shows. */
  clear: PixelRect[];
  /** Animation clock in milliseconds; 0 with reduced motion. */
  now: number;
}

export function drawCover(context: Ctx, frame: CoverFrame) {
  const { canvas } = context;
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (frame.coverage <= 0) return;
  context.drawImage(frame.map.frames[Math.floor(frame.now / 700) % 2], 0, 0);
  const [sx, sy] = frame.map.points[0] ?? [canvas.width / 2, canvas.height / 2];
  const { shadow, run, ride } = sprites();
  const walker = frame.kind === "ride" ? ride : run;
  const bob = Math.floor(frame.now / 480) % 2;
  context.drawImage(shadow, Math.round(sx) - 7, Math.round(sy) - 1);
  context.drawImage(walker.down[0], Math.round(sx) - 8, Math.round(sy) - 15 - bob);

  if (frame.coverage < 1) {
    const columns = Math.ceil(canvas.width / frame.cell);
    const rows = Math.ceil(canvas.height / frame.cell);
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < columns; x += 1) {
        if (!cellCovered(x, y, frame.coverage)) context.clearRect(x * frame.cell, y * frame.cell, frame.cell, frame.cell);
      }
    }
  }
  for (const rect of frame.clear) context.clearRect(rect.left, rect.top, rect.width, rect.height);
}
