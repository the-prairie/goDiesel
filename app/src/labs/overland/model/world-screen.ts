// The world map's screen on a phone: as large as the phone allows, at a
// whole-pixel scale, edge to edge, with the keys in a bar at the bottom in
// thumb reach and the safe areas left clear.

import { WORLD_MAP } from "@/labs/overland/model/overland-towns";
import type { Insets } from "@/labs/overland/model/realm-layout";

/** The keys' bar under the screen: the 60 px Open key and 12 px above and below. */
export const PHONE_KEYS_PX = 84;

/** A phone, or any short screen such as a phone held sideways. */
export const PHONE_QUERY = "(max-width: 767px), (max-height: 520px)";
/** A phone screen keeps at least this many pixel columns and rows. */
const MIN_PIXELS = 120;
/** The world map's text box, in pixel rows. */
const BOX_ROWS = 34;

export interface PhoneWorldScreen {
  /** CSS pixels per screen pixel. */
  scale: number;
  cols: number;
  rows: number;
}

export function phoneWorldScreen({ width, height, safe }: { width: number; height: number; safe: Insets }): PhoneWorldScreen {
  const usableWidth = width - safe.left - safe.right;
  const usableHeight = height - safe.top - safe.bottom - PHONE_KEYS_PX;
  const scale = [4, 3].find((candidate) => usableWidth / candidate >= MIN_PIXELS && usableHeight / candidate >= MIN_PIXELS) ?? 2;
  return {
    scale,
    cols: Math.min(WORLD_MAP.width, Math.floor(usableWidth / scale)),
    rows: Math.min(WORLD_MAP.height + BOX_ROWS, Math.floor(usableHeight / scale)),
  };
}
