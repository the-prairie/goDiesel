// The ridge's one pointer: a tap on the marker plays or pauses; a press
// elsewhere takes her there; a drag scrubs; a still hold opens the ridge to
// the 6 km round her until release. One pointer at a time; the adapter
// (overland-realm) runs the hold timer and applies the effect.

export type RidgeGestureState =
  | { phase: "idle" }
  | { phase: "pressing"; pointerId: number; startX: number; lastX: number; onMarker: boolean; moved: boolean; zoomed: boolean };

export type RidgeGestureEvent =
  | { type: "down"; pointerId: number; x: number; onMarker: boolean }
  | { type: "move"; pointerId: number; x: number }
  | { type: "holdElapsed"; pointerId: number }
  | { type: "up"; pointerId: number }
  | { type: "cancel"; pointerId: number };

export type RidgeEffect = { type: "toggle" } | { type: "seekTo"; x: number } | { type: "scrub"; dx: number } | { type: "zoom"; on: boolean };

/** How far a thumb may wander before a tap becomes a drag, in CSS px. */
export const TAP_SLOP_PX = 6;
/** How long a still press takes to open the ridge. */
export const HOLD_MS = 260;

export function initialRidgeGesture(): RidgeGestureState {
  return { phase: "idle" };
}

export function reduceRidgeGesture(state: RidgeGestureState, event: RidgeGestureEvent): { state: RidgeGestureState; effect?: RidgeEffect } {
  if (event.type === "down") {
    if (state.phase !== "idle") return { state };
    const next: RidgeGestureState = { phase: "pressing", pointerId: event.pointerId, startX: event.x, lastX: event.x, onMarker: event.onMarker, moved: false, zoomed: false };
    return { state: next, effect: event.onMarker ? undefined : { type: "seekTo", x: event.x } };
  }
  if (state.phase !== "pressing" || event.pointerId !== state.pointerId) return { state };
  switch (event.type) {
    case "move": {
      const moved = state.moved || Math.abs(event.x - state.startX) > TAP_SLOP_PX;
      if (state.onMarker && !moved) return { state: { ...state, moved } };
      const dx = event.x - state.lastX;
      return { state: { ...state, moved, lastX: event.x }, effect: dx ? { type: "scrub", dx } : undefined };
    }
    case "holdElapsed":
      if (state.moved || state.zoomed) return { state };
      return { state: { ...state, zoomed: true }, effect: { type: "zoom", on: true } };
    case "up":
      if (state.zoomed) return { state: initialRidgeGesture(), effect: { type: "zoom", on: false } };
      return { state: initialRidgeGesture(), effect: state.onMarker && !state.moved ? { type: "toggle" } : undefined };
    case "cancel":
      return { state: initialRidgeGesture(), effect: state.zoomed ? { type: "zoom", on: false } : undefined };
  }
}
