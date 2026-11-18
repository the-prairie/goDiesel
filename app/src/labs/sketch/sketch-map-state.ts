/**
 * The sketch map's life: it loads, becomes ready once it has drawn, and is
 * unavailable when it cannot start (no WebGL, or its style cannot load).
 * Tiles that fail, before or after it has drawn, leave it degraded: paper
 * and her routes, still usable, until tiles arrive again. Every event
 * carries the load it belongs to; an event from an earlier load is ignored.
 */

export type SketchMapFailure = "webgl" | "style";

export type SketchMapState =
  | { phase: "idle" }
  | { phase: "loading"; loadId: number }
  | { phase: "ready"; loadId: number }
  | { phase: "degraded"; loadId: number }
  | { phase: "unavailable"; loadId: number; reason: SketchMapFailure };

export type SketchMapEvent =
  | { type: "loadStarted"; loadId: number }
  | { type: "mapReady"; loadId: number }
  | { type: "tilesFailed"; loadId: number }
  | { type: "tilesLoaded"; loadId: number }
  | { type: "mapFailed"; loadId: number; reason: SketchMapFailure }
  | { type: "disposed" };

export function initialSketchMapState(): SketchMapState {
  return { phase: "idle" };
}

export function reduceSketchMap(state: SketchMapState, event: SketchMapEvent): SketchMapState {
  if (event.type === "loadStarted") return { phase: "loading", loadId: event.loadId };
  if (event.type === "disposed") return { phase: "idle" };
  if (state.phase === "idle" || state.loadId !== event.loadId || state.phase === "unavailable") return state;
  switch (event.type) {
    case "mapReady":
      return state.phase === "loading" ? { phase: "ready", loadId: event.loadId } : state;
    case "tilesLoaded":
      return state.phase === "degraded" ? { phase: "ready", loadId: event.loadId } : state;
    case "tilesFailed":
      return state.phase === "degraded" ? state : { phase: "degraded", loadId: event.loadId };
    case "mapFailed":
      return { phase: "unavailable", loadId: event.loadId, reason: event.reason };
  }
}
