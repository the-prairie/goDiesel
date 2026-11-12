// The handheld screens, drawn at their native pixel size. Each function
// paints one frame from plain data; the page decides when to call it.

import { context2d, makeCanvas, roundRect, type Ctx } from "@/labs/overland/engine/canvas";
import { graphemesOf, measureText } from "@/labs/overland/engine/font";
import { C } from "@/labs/overland/engine/palette";
import { routeMap, type RouteMapInput } from "@/labs/overland/engine/route-map";
import { sprites, townIcon } from "@/labs/overland/engine/sprites";
import { bigLine, clipText, drawFrame, drawText } from "@/labs/overland/engine/text-draw";
import { worldFrames } from "@/labs/overland/engine/world";
import type { OverlandEntry } from "@/labs/overland/model/overland-entries";
import type { OverlandTown } from "@/labs/overland/model/overland-towns";
import { formatEntryDate, routeNumberLabel, wrapText } from "@/labs/overland/model/text-box";

export const SCREEN_WIDTH = 152;
export const WORLD_HEIGHT = 136;
export const WORLD_BOX_HEIGHT = 34;
export const ENTRY_HEIGHT = 184;
export const ENTRY_BOX_HEIGHT = 46;
export const INDEX_ROW_HEIGHT = 24;
/** The entry's little route map, in screen pixels; the jump dives into it. */
export const ENTRY_MAP = { left: 8, top: 23, width: 56, height: 48 } as const;

/** Wraps for a text box line of the given width, in the Overland font. */
export function wrapForBox(text: string, width: number, bold = false) {
  return wrapText(text, width, (line) => measureText(line, bold));
}

/** Lines revealed so far by the typing effect; `shown` counts graphemes. */
function typed(lines: string[], shown: number) {
  let left = shown;
  const out: string[] = [];
  for (const line of lines) {
    if (left <= 0) break;
    const graphemes = graphemesOf(line);
    out.push(left >= graphemes.length ? line : graphemes.slice(0, left).join(""));
    left -= graphemes.length;
  }
  return out;
}

export function typedLength(lines: string[]) {
  return lines.reduce((sum, line) => sum + graphemesOf(line).length, 0);
}

function moreArrow(context: Ctx, x: number, y: number, blink: boolean) {
  context.drawImage(sprites().icons.down, x, y + (blink ? 1 : 0));
}

export interface WorldFrame {
  camX: number;
  camY: number;
  towns: OverlandTown[];
  selected: number;
  /** The town of her most recent route, where the runner stands. */
  homeTown: number;
  lines: string[];
  shown: number;
  /** Animation clock in milliseconds; frozen at 0 with reduced motion. */
  now: number;
}

export function drawWorldScreen(context: Ctx, frame: WorldFrame) {
  const w = SCREEN_WIDTH;
  const h = WORLD_HEIGHT;
  const world = worldFrames()[Math.floor(frame.now / 700) % 2];
  const cx = Math.round(frame.camX);
  const cy = Math.round(frame.camY);
  context.fillStyle = C.w3;
  context.fillRect(0, 0, w, h);
  context.drawImage(world, -cx, -cy);
  for (const town of frame.towns) context.drawImage(townIcon(town.routeCount), Math.round(town.x) - cx - 7, Math.round(town.y) - cy - 7);
  const home = frame.towns[frame.homeTown];
  if (home) {
    const bob = Math.floor(frame.now / 480) % 2;
    const { run, shadow } = sprites();
    context.drawImage(shadow, Math.round(home.x) - cx - 1, Math.round(home.y) - cy + 2);
    context.drawImage(run.down[0], Math.round(home.x) - cx + 1, Math.round(home.y) - cy - 13 - bob);
  }
  const chosen = frame.towns[frame.selected];
  if (chosen) {
    const bx = Math.round(chosen.x) - cx - 10;
    const by = Math.round(chosen.y) - cy - 10;
    const o = Math.floor(frame.now / 400) % 2;
    context.fillStyle = C.acc;
    for (const [x, y, dx, dy] of [[bx + o, by + o, 1, 1], [bx + 19 - o, by + o, -1, 1], [bx + o, by + 18 - o, 1, -1], [bx + 19 - o, by + 18 - o, -1, -1]]) {
      context.fillRect(x, y, dx * 3, dy);
      context.fillRect(x, y, dx, dy * 3);
    }
  }
  drawFrame(context, 0, h - WORLD_BOX_HEIGHT, w, WORLD_BOX_HEIGHT);
  typed(frame.lines, frame.shown).slice(0, 2).forEach((line, index) => {
    drawText(context, line, 8, h - 27 + index * 11, C.ink, index === 0);
  });
}

export interface EntryFrame {
  entry: OverlandEntry;
  map: RouteMapInput;
  /** The current page of the text box, already wrapped. */
  lines: string[];
  shown: number;
  morePages: boolean;
  now: number;
}

const NOT_RECORDED = "Not recorded";

export function drawEntryScreen(context: Ctx, frame: EntryFrame) {
  const w = SCREEN_WIDTH;
  const h = ENTRY_HEIGHT;
  const { entry } = frame;
  context.fillStyle = C.paper;
  context.fillRect(0, 0, w, h);

  // Header: the route number, and run or ride.
  context.fillStyle = C.ink;
  context.fillRect(0, 0, w, 16);
  drawText(context, routeNumberLabel(entry.number), 6, 5, C.paper, true);
  const kind = entry.kind === "ride" ? "Ride" : "Run";
  drawText(context, kind, w - 6 - measureText(kind), 5, C.paper);

  // Her line on its own little map, with the runner or rider at the start.
  const map = routeMap(frame.map, ENTRY_MAP.width, ENTRY_MAP.height, [4, 4, 4, 4]);
  roundRect(context, ENTRY_MAP.left - 2, ENTRY_MAP.top - 2, ENTRY_MAP.width + 4, ENTRY_MAP.height + 4, C.ink);
  context.drawImage(map.frames[Math.floor(frame.now / 700) % 2], ENTRY_MAP.left, ENTRY_MAP.top);
  const walker = entry.kind === "ride" ? sprites().ride : sprites().run;
  const [sx, sy] = map.points[0];
  context.drawImage(sprites().shadow, ENTRY_MAP.left + Math.round(sx) - 7, ENTRY_MAP.top + Math.round(sy) - 1);
  context.drawImage(walker.down[0], ENTRY_MAP.left + Math.round(sx) - 8, ENTRY_MAP.top + Math.round(sy) - 15);

  // Facts.
  const sx2 = 74;
  const facts: Array<[string, string]> = [
    ["KM", entry.km.toFixed(1)],
    ["CLIMB", entry.climbM === null ? NOT_RECORDED : `${entry.climbM.toLocaleString("en")} m`],
  ];
  facts.forEach(([label, value], index) => {
    const y = 23 + index * 12;
    drawText(context, label, sx2, y, C.mute);
    drawText(context, value, w - 6 - measureText(value), y, C.ink);
    context.fillStyle = C.paper3;
    context.fillRect(sx2, y + 9, w - 6 - sx2, 1);
  });
  drawText(context, formatEntryDate(entry.date), sx2, 48, C.ink2);
  const place = wrapForBox(entry.place, w - 6 - sx2);
  drawText(context, clipText(place[0] ?? "", w - 6 - sx2), sx2, 59, C.ink2);
  if (place[1]) drawText(context, clipText(place.slice(1).join(" "), w - 6 - sx2), sx2, 68, C.ink2);

  // Her title: large when it fits in three lines, otherwise in bold.
  const titleTop = 80;
  const large = wrapForBox(entry.title, Math.floor((w - 14) / 2));
  if (large.length > 0 && large.length <= 3) {
    large.forEach((line, index) => context.drawImage(bigLine(line, C.ink), 7, titleTop + index * 19));
  } else {
    wrapForBox(entry.title, w - 14, true)
      .slice(0, 5)
      .forEach((line, index) => drawText(context, line, 7, titleTop + index * 11, C.ink, true));
  }

  // The text box: her note, or the route's facts.
  drawFrame(context, 0, h - ENTRY_BOX_HEIGHT, w, ENTRY_BOX_HEIGHT);
  typed(frame.lines, frame.shown).forEach((line, index) => drawText(context, line, 8, h - 38 + index * 11, C.ink));
  if (frame.morePages && frame.shown >= typedLength(frame.lines)) {
    moreArrow(context, w - 14, h - 11, Math.floor(frame.now / 400) % 2 === 1);
  }
}

/** One row of the index, for a button of its own. */
export function drawIndexRow(entry: OverlandEntry, selected: boolean) {
  const w = SCREEN_WIDTH;
  const canvas = makeCanvas(w, INDEX_ROW_HEIGHT);
  const context = context2d(canvas);
  const { icons } = sprites();
  context.fillStyle = selected ? C.paper2 : C.paper;
  context.fillRect(0, 0, w, INDEX_ROW_HEIGHT);
  context.fillStyle = C.paper3;
  context.fillRect(4, INDEX_ROW_HEIGHT - 1, w - 8, 1);
  if (selected) context.drawImage(icons.cursor, 1, 8);
  drawText(context, String(entry.number).padStart(3, "0"), 7, 4, selected ? C.acc2 : C.mute);
  const ride = entry.kind === "ride";
  context.drawImage(ride ? icons.wheel : icons.shoe, ride ? 12 : 11, ride ? 14 : 15);
  const titleWidth = w - 30 - (entry.note ? 10 : 0);
  drawText(context, clipText(entry.title, titleWidth), 28, 4, C.ink);
  drawText(context, clipText(entry.place, w - 60), 28, 14, C.mute);
  const km = `${entry.km.toFixed(1)} km`;
  drawText(context, km, w - 6 - measureText(km), 14, C.ink2);
  if (entry.note) context.drawImage(icons.star, w - 11, 3);
  return canvas;
}

/** A short label in the Overland font, for the keys under the screen. */
export function drawLabel(text: string, colour: string, bold = false) {
  const canvas = makeCanvas(Math.max(1, measureText(text, bold)), 9);
  drawText(context2d(canvas), text, 0, 0, colour, bold);
  return canvas;
}
