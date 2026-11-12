import type { Rect } from "@/labs/overland/model/realm-layout";

/**
 * Where the dive starts: the full-screen cover, scaled evenly and clipped
 * so that the part still showing sits exactly over the entry's little map.
 * The transform's origin is the cover's top-left corner; `clip` is an
 * inset in the cover's own pixels. The dive animates both to nothing.
 */
export function diveStart(mini: Rect, viewport: { width: number; height: number }) {
  const { width, height } = viewport;
  const scale = Math.max(mini.width / width, mini.height / height);
  const shownWidth = mini.width / scale;
  const shownHeight = mini.height / scale;
  const left = (width - shownWidth) / 2;
  const top = (height - shownHeight) / 2;
  return {
    scale,
    translateX: mini.left - scale * left,
    translateY: mini.top - scale * top,
    clip: { top, right: left, bottom: top, left },
  };
}
