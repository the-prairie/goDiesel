import type {
  GoogleRendererUnavailableReason,
  GoogleRouteNavigatorStatus,
} from "@/surfaces/replay/renderers/google-renderer-state";

/**
 * The jump from the pixel world into a route's photorealistic replay, and
 * back. The reducer owns the phases; the realm component owns the engine,
 * the timers and the drawing, and dispatches only phase changes.
 *
 * `wipe` is the default: our pixel art covers the live map, which is only
 * ever shown at full resolution and unaltered, and the cover clears in
 * blocks. `live` steps the live map's own pixel level and exists for local
 * comparison only. `town` starts in a 3D town: the town's own camera dives
 * and the town is the cover, fading out over the live map in the same steps.
 */
export type JumpTransition = "wipe" | "live" | "town";

/** Blocks of the cover cleared per step, from fully covered to clear. */
export const WIPE_STEPS = 8;
/** The live comparison's pixel levels; the last is full resolution. */
export const LIVE_PIXEL_LEVELS: readonly number[] = [6, 4, 3, 2, 1];

type Scene = "loading" | "ready";

interface Jump {
  jumpId: number;
  slug: string;
  reducedMotion: boolean;
  transition: JumpTransition;
}

export type OverlandJumpState =
  | { phase: "browsing"; lastJumpId: number; slug?: string }
  | ({ phase: "diving"; scene: Scene } & Jump)
  | ({ phase: "holding" } & Jump)
  | ({ phase: "resolving"; step: number } & Jump)
  | ({ phase: "realm" } & Jump)
  | ({ phase: "surfacing"; step: number } & Jump)
  | ({ phase: "fallback"; reason?: GoogleRendererUnavailableReason } & Jump);

export type OverlandJumpEvent =
  | { type: "jumpRequested"; slug: string; reducedMotion: boolean; transition: JumpTransition }
  | { type: "diveFinished"; jumpId: number }
  | {
      type: "sceneStatusReceived";
      jumpId: number;
      status: GoogleRouteNavigatorStatus;
      reason?: GoogleRendererUnavailableReason;
    }
  | { type: "resolveStepElapsed"; jumpId: number }
  | { type: "skipRequested" }
  | { type: "cancelRequested" }
  | { type: "leaveRequested" }
  | { type: "surfaceFinished"; jumpId: number };

export function initialOverlandJumpState(): OverlandJumpState {
  return { phase: "browsing", lastJumpId: 0 };
}

function jumpOf(state: Exclude<OverlandJumpState, { phase: "browsing" }>): Jump {
  return {
    jumpId: state.jumpId,
    slug: state.slug,
    reducedMotion: state.reducedMotion,
    transition: state.transition,
  };
}

function stepCount(jump: Jump) {
  return jump.transition === "live" ? LIVE_PIXEL_LEVELS.length - 1 : WIPE_STEPS;
}

function browsing(jump: Jump): OverlandJumpState {
  return { phase: "browsing", lastJumpId: jump.jumpId, slug: jump.slug };
}

/** Where a ready scene goes once nothing is left to play before it. */
function revealed(jump: Jump): OverlandJumpState {
  return jump.reducedMotion ? { phase: "realm", ...jump } : { phase: "resolving", step: 0, ...jump };
}

export function reduceOverlandJump(
  state: OverlandJumpState,
  event: OverlandJumpEvent,
): OverlandJumpState {
  if (event.type === "jumpRequested") {
    if (state.phase !== "browsing") return state;
    const jump: Jump = {
      jumpId: state.lastJumpId + 1,
      slug: event.slug,
      reducedMotion: event.reducedMotion,
      transition: event.transition,
    };
    return jump.reducedMotion ? { phase: "holding", ...jump } : { phase: "diving", scene: "loading", ...jump };
  }
  if (state.phase === "browsing") return state;
  if ("jumpId" in event && event.jumpId !== state.jumpId) return state;
  const jump = jumpOf(state);

  switch (event.type) {
    case "sceneStatusReceived": {
      if (state.phase === "fallback" || state.phase === "surfacing") return state;
      if (event.status.state === "unavailable") {
        return { phase: "fallback", ...jump, reason: event.reason };
      }
      if (event.status.state !== "ready") return state;
      if (state.phase === "diving") return { ...state, scene: "ready" };
      if (state.phase === "holding") return revealed(jump);
      return state;
    }
    case "diveFinished":
      if (state.phase !== "diving") return state;
      return state.scene === "ready" ? revealed(jump) : { phase: "holding", ...jump };
    case "resolveStepElapsed":
      if (state.phase === "surfacing") return surfaceCovered(state) ? state : { ...state, step: state.step + 1 };
      if (state.phase !== "resolving") return state;
      return state.step + 1 >= stepCount(jump)
        ? { phase: "realm", ...jump }
        : { ...state, step: state.step + 1 };
    case "skipRequested":
      // Any key or tap during a transition jumps to where it was going.
      if (state.phase === "diving") return state.scene === "ready" ? { phase: "realm", ...jump } : { phase: "holding", ...jump };
      if (state.phase === "resolving") return { phase: "realm", ...jump };
      if (state.phase === "surfacing") return browsing(jump);
      return state;
    case "cancelRequested":
      return state.phase === "diving" || state.phase === "holding" ? browsing(jump) : state;
    case "leaveRequested":
      if (state.phase === "fallback" || state.phase === "diving" || state.phase === "holding") return browsing(jump);
      if (state.phase === "realm" || state.phase === "resolving") return { phase: "surfacing", step: 0, ...jump };
      return state;
    case "surfaceFinished":
      return state.phase === "surfacing" ? browsing(jump) : state;
    default: {
      const unhandled: never = event;
      return unhandled;
    }
  }
}

/**
 * Whether the way out has stepped back to a full cover, so the dive can
 * play in reverse. With reduced motion there are no steps: the whole scene
 * crossfades away instead.
 */
export function surfaceCovered(state: OverlandJumpState) {
  if (state.phase !== "surfacing") return false;
  return state.reducedMotion || state.step >= stepCount(state);
}

export interface JumpPresentation {
  /** Whether the live 3D map is shown at all. */
  liveMap: boolean;
  /** The live map's pixel level: 1 is full resolution, unaltered. */
  pixelLevel: number;
  /** How much of the screen our pixel cover still hides, from 1 to 0. */
  coverCoverage: number;
}

export function jumpPresentation(state: OverlandJumpState): JumpPresentation {
  switch (state.phase) {
    case "browsing":
    case "fallback":
    case "diving":
    case "holding":
      return { liveMap: false, pixelLevel: 1, coverCoverage: 1 };
    case "resolving":
      return state.transition === "live"
        ? { liveMap: true, pixelLevel: LIVE_PIXEL_LEVELS[state.step], coverCoverage: 0 }
        : { liveMap: true, pixelLevel: 1, coverCoverage: 1 - state.step / WIPE_STEPS };
    case "realm":
      return { liveMap: true, pixelLevel: 1, coverCoverage: 0 };
    case "surfacing":
      if (state.reducedMotion) return { liveMap: true, pixelLevel: 1, coverCoverage: 0 };
      if (surfaceCovered(state)) return { liveMap: false, pixelLevel: 1, coverCoverage: 1 };
      return state.transition === "live"
        ? { liveMap: true, pixelLevel: [...LIVE_PIXEL_LEVELS].reverse()[state.step], coverCoverage: 0 }
        : { liveMap: true, pixelLevel: 1, coverCoverage: state.step / WIPE_STEPS };
    default: {
      const unhandled: never = state;
      return unhandled;
    }
  }
}

export interface TownCover {
  /** The town layer's opacity over the live map. */
  opacity: number;
  /** Whether the town is drawn above the live map. */
  above: boolean;
  /** Whether the bottom attribution band is cut out of the town layer. */
  clipBand: boolean;
  /** Whether the town takes input. */
  interactive: boolean;
}

/**
 * How a 3D town covers the live map through a jump that starts in it. It
 * covers it whole until the map is shown; then it fades in the wipe's steps
 * with the attribution band cut out, so Google's logo and credits are never
 * under anything of ours. With reduced motion it cuts in and fades back out.
 */
export function townCover(state: OverlandJumpState): TownCover {
  const { liveMap, coverCoverage } = jumpPresentation(state);
  switch (state.phase) {
    case "browsing":
      return { opacity: 1, above: false, clipBand: false, interactive: true };
    case "realm":
      return { opacity: 0, above: false, clipBand: false, interactive: false };
    default: {
      const opacity = state.phase === "surfacing" && state.reducedMotion ? 1 : coverCoverage;
      return { opacity, above: true, clipBand: liveMap && opacity > 0, interactive: false };
    }
  }
}
