/**
 * The hand-over between the drawn city (our OpenStreetMap sketch) and the
 * real city (Google's Photorealistic 3D Tiles drawn as a sketch), as plan
 * decision S17 sets out. Zooming into a covered city on a capable device
 * loads the real city while the drawn one stays on screen; once its first
 * view is drawn it fades in. Too slow (about 8 s) or failing, it is declined
 * and the drawn city stays; a declined city is tried again only after the
 * camera has left it. Zooming out below the exit zoom fades it out and tears
 * it down. Enter and exit zooms differ, so it never flickers at the edge.
 * Every answer carries its load; one from an abandoned load is ignored.
 */

export const ENTER_ZOOM = 14.5;
export const EXIT_ZOOM = 14;
/** How long the real city's first view may take before the drawn one is kept. */
export const FIRST_VIEW_TIMEOUT_MS = 8000;

export type DeclineReason = "no-coverage" | "no-webgl2" | "low-memory" | "save-data" | "slow" | "tiles";

export type Eligibility = { ok: true; city: string } | { ok: false; reason: Exclude<DeclineReason, "slow" | "tiles"> };

export function eligibility({ city, webgl2, deviceMemoryGb, saveData }: { city: string | null; webgl2: boolean; deviceMemoryGb: number | undefined; saveData: boolean }): Eligibility {
  if (!city) return { ok: false, reason: "no-coverage" };
  if (!webgl2) return { ok: false, reason: "no-webgl2" };
  if (deviceMemoryGb !== undefined && deviceMemoryGb < 4) return { ok: false, reason: "low-memory" };
  if (saveData) return { ok: false, reason: "save-data" };
  return { ok: true, city };
}

export type HandoverState =
  | { phase: "drawn"; lastLoadId?: number }
  | { phase: "loading"; loadId: number; city: string; startedMs: number }
  | { phase: "fadingIn"; loadId: number; city: string }
  | { phase: "real"; loadId: number; city: string }
  | { phase: "fadingOut"; loadId: number }
  | { phase: "declined"; reason: DeclineReason; lastLoadId?: number };

export type HandoverEvent =
  | { type: "zoomChanged"; zoom: number; eligible: Eligibility; nowMs: number }
  | { type: "firstViewDrawn"; loadId: number }
  | { type: "timedOut"; loadId: number }
  | { type: "failed"; loadId: number }
  | { type: "fadeFinished"; loadId: number };

export function initialHandoverState(): HandoverState {
  return { phase: "drawn" };
}

const lastId = (state: HandoverState) => ("loadId" in state ? state.loadId : (state.lastLoadId ?? 0));

export function reduceHandover(state: HandoverState, event: HandoverEvent): HandoverState {
  if (event.type === "zoomChanged") {
    const inside = event.zoom >= ENTER_ZOOM;
    const outside = event.zoom < EXIT_ZOOM;
    switch (state.phase) {
      case "drawn":
        if (!inside) return state;
        if (!event.eligible.ok) return { phase: "declined", reason: event.eligible.reason, lastLoadId: state.lastLoadId };
        return { phase: "loading", loadId: lastId(state) + 1, city: event.eligible.city, startedMs: event.nowMs };
      case "declined":
        return outside ? { phase: "drawn", lastLoadId: state.lastLoadId } : state;
      case "loading":
        return outside ? { phase: "drawn", lastLoadId: state.loadId } : state;
      case "fadingIn":
      case "real":
        return outside ? { phase: "fadingOut", loadId: state.loadId } : state;
      case "fadingOut":
        return state;
    }
  }
  if (!("loadId" in state) || state.loadId !== event.loadId) return state;
  switch (event.type) {
    case "firstViewDrawn":
      return state.phase === "loading" ? { phase: "fadingIn", loadId: state.loadId, city: state.city } : state;
    case "timedOut":
      return state.phase === "loading" ? { phase: "declined", reason: "slow", lastLoadId: state.loadId } : state;
    case "failed":
      return state.phase === "loading" || state.phase === "fadingIn" || state.phase === "real" ? { phase: "declined", reason: "tiles", lastLoadId: state.loadId } : state;
    case "fadeFinished":
      if (state.phase === "fadingIn") return { phase: "real", loadId: state.loadId, city: state.city };
      if (state.phase === "fadingOut") return { phase: "drawn", lastLoadId: state.loadId };
      return state;
  }
}
