/**
 * Where the mobile route sheet comes to rest after a drag.
 *
 * The sheet's position is local UI state with no ordering or identity, so it
 * stays a `useState` in the page rather than a registered lifecycle. This
 * module only decides the snap, so the gesture can be tested without a DOM.
 */
export type RouteSheetPosition = "peek" | "half" | "expanded";

export const ROUTE_SHEET_POSITIONS: readonly RouteSheetPosition[] = ["peek", "half", "expanded"];

/** Mirrors the sheet's classes: `h-[16rem]`, `h-[58dvh]`, `h-[calc(100%-0.75rem)]`. */
const PEEK_PX = 256;
const HALF_VIEWPORT_SHARE = 0.58;
const EXPANDED_INSET_PX = 12;

/** How far a release keeps travelling: velocity × this time. */
const PROJECTION_MS = 200;
/** A release at least this fast (px/ms) is a flick and commits to its direction. */
const FLICK_PX_PER_MS = 0.4;

export function routeSheetHeights(viewportHeight: number, containerHeight: number): Record<RouteSheetPosition, number> {
  const expanded = Math.max(0, containerHeight - EXPANDED_INSET_PX);
  const peek = Math.min(PEEK_PX, expanded);
  const half = Math.min(expanded, Math.max(peek, viewportHeight * HALF_VIEWPORT_SHARE));
  return { peek, half, expanded };
}

/**
 * `dragPx` and `velocityPxPerMs` are screen-space: positive means the finger
 * moved down, which makes the sheet shorter.
 */
export function snapRouteSheet({
  from,
  dragPx,
  velocityPxPerMs,
  viewportHeight,
  containerHeight,
}: {
  from: RouteSheetPosition;
  dragPx: number;
  velocityPxPerMs: number;
  viewportHeight: number;
  containerHeight: number;
}): RouteSheetPosition {
  const heights = routeSheetHeights(viewportHeight, containerHeight);
  const current = clamp(heights[from] - dragPx, heights.peek, heights.expanded);
  const projected = current - velocityPxPerMs * PROJECTION_MS;

  let candidates = [...ROUTE_SHEET_POSITIONS];
  if (Math.abs(velocityPxPerMs) >= FLICK_PX_PER_MS) {
    const growing = velocityPxPerMs < 0;
    const ahead = candidates.filter((position) =>
      growing ? heights[position] > current : heights[position] < current,
    );
    candidates = ahead.length > 0 ? ahead : [growing ? "expanded" : "peek"];
  }

  return candidates.reduce((best, position) =>
    Math.abs(heights[position] - projected) < Math.abs(heights[best] - projected) ? position : best,
  );
}

/** One pointer sample: `y` in px, `t` the event's own `timeStamp` in ms. */
export type SheetSample = { y: number; t: number };

/** The window of event time that defines a release's velocity. */
const VELOCITY_WINDOW_MS = 100;

/**
 * Finger speed over the last 100 ms of a drag, in px/ms (positive = down).
 * Pass event `timeStamp`s, not the time handlers ran: a busy main thread
 * delivers pointer events late, but their stamps still say when the finger
 * moved, so a fast flick on a janky frame still reads as a flick.
 */
export function releaseVelocity(samples: readonly SheetSample[]) {
  const last = samples.at(-1);
  if (!last) return 0;
  const reference = samples.find((sample) => last.t - sample.t <= VELOCITY_WINDOW_MS) ?? last;
  const elapsed = last.t - reference.t;
  return elapsed > 0 ? (last.y - reference.y) / elapsed : 0;
}

/** The sheet height in px while a finger holds it, bounded by the outer stops. */
export function draggedRouteSheetHeight(from: RouteSheetPosition, dragPx: number, viewportHeight: number, containerHeight: number) {
  const heights = routeSheetHeights(viewportHeight, containerHeight);
  return clamp(heights[from] - dragPx, heights.peek, heights.expanded);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
