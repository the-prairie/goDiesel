/**
 * Moments along a route in the realm: her annotations, met as the runner
 * reaches each one's distance. A moment ahead is approached (playback slows
 * a little), shown when reached (slower still, for a while), and tucked
 * away; one whose photo the viewer opens pauses playback until closed.
 * Moments passed together wait their turn. Scrubbing forward skips the
 * moments passed; scrubbing back brings back those now ahead. The realm
 * dispatches progress from its throttled replay snapshots; the anchor id
 * is the identity, and an event for any other moment is ignored.
 */

export interface MomentAnchor {
  id: string;
  atDistanceM: number;
  hasMedia: boolean;
}

/** How far ahead a moment starts to slow playback, in metres. */
export const APPROACH_M = 120;
/** How long a moment stays on screen while playing, in milliseconds. */
export const SHOW_MS = 6000;
/** A shorter stay when another moment is waiting. */
export const QUEUED_SHOW_MS = 3500;

export type MomentPhase = "idle" | "approaching" | "showing" | "mediaOpen" | "dismissed";

interface Common {
  anchors: readonly MomentAnchor[];
  /** Ids of moments shown and put away, or skipped by a scrub. */
  dismissed: readonly string[];
  /** Ids reached while another was on screen, in order. */
  queue: readonly string[];
  progressM: number;
}

export type OverlandMomentsState =
  | ({ phase: "idle" } & Common)
  | ({ phase: "approaching"; id: string } & Common)
  | ({ phase: "showing"; id: string; shownAt: number } & Common)
  | ({ phase: "mediaOpen"; id: string } & Common);

export type OverlandMomentsEvent =
  | { type: "progressed"; progressM: number; playing: boolean; nowMs: number }
  | { type: "seeked"; progressM: number }
  | { type: "dismissRequested"; id: string; nowMs: number }
  | { type: "mediaOpened"; id: string }
  | { type: "mediaClosed"; id: string; nowMs: number };

export function initialOverlandMomentsState(anchors: readonly MomentAnchor[]): OverlandMomentsState {
  return { phase: "idle", anchors: [...anchors].sort((a, b) => a.atDistanceM - b.atDistanceM), dismissed: [], queue: [], progressM: 0 };
}

function common(state: OverlandMomentsState): Common {
  return { anchors: state.anchors, dismissed: state.dismissed, queue: state.queue, progressM: state.progressM };
}

/** With nothing on screen: the next waiting moment, or an approach, or idle. */
function settle(base: Common, nowMs: number): OverlandMomentsState {
  const [next, ...rest] = base.queue;
  if (next) return { phase: "showing", id: next, shownAt: nowMs, ...base, queue: rest };
  const ahead = base.anchors.find(
    (anchor) => !base.dismissed.includes(anchor.id) && anchor.atDistanceM > base.progressM && anchor.atDistanceM - base.progressM <= APPROACH_M,
  );
  return ahead ? { phase: "approaching", id: ahead.id, ...base } : { phase: "idle", ...base };
}

function putAway(state: OverlandMomentsState & { id: string }, nowMs: number): OverlandMomentsState {
  return settle({ ...common(state), dismissed: [...state.dismissed, state.id] }, nowMs);
}

export function reduceOverlandMoments(state: OverlandMomentsState, event: OverlandMomentsEvent): OverlandMomentsState {
  switch (event.type) {
    case "progressed": {
      const from = state.progressM;
      const base: Common = { ...common(state), progressM: event.progressM };
      if (!event.playing || event.progressM <= from) {
        return state.phase === "idle" || state.phase === "approaching" ? settle(base, event.nowMs) : { ...state, progressM: event.progressM };
      }
      const current = state.phase === "showing" || state.phase === "mediaOpen" ? state.id : null;
      const reached = base.anchors
        .filter((anchor) => anchor.atDistanceM > from && anchor.atDistanceM <= event.progressM)
        .map((anchor) => anchor.id)
        .filter((id) => !base.dismissed.includes(id) && !base.queue.includes(id) && id !== current);
      const withReached: Common = { ...base, queue: [...base.queue, ...reached] };
      if (state.phase === "mediaOpen") return { ...state, ...withReached };
      if (state.phase === "showing") {
        const stay = withReached.queue.length ? QUEUED_SHOW_MS : SHOW_MS;
        if (event.nowMs - state.shownAt < stay) return { ...state, ...withReached };
        return settle({ ...withReached, dismissed: [...withReached.dismissed, state.id] }, event.nowMs);
      }
      return settle(withReached, event.nowMs);
    }
    case "seeked": {
      const back = event.progressM < state.progressM;
      const dismissed = back
        ? state.dismissed.filter((id) => (state.anchors.find((anchor) => anchor.id === id)?.atDistanceM ?? 0) <= event.progressM)
        : [
            ...state.dismissed,
            ...state.anchors
              .filter((anchor) => anchor.atDistanceM > state.progressM && anchor.atDistanceM <= event.progressM && !state.dismissed.includes(anchor.id))
              .map((anchor) => anchor.id),
          ];
      const base: Common = { anchors: state.anchors, dismissed, queue: [], progressM: event.progressM };
      // A moment on screen is put away; one now ahead of the runner is armed again.
      if (state.phase === "showing" || state.phase === "mediaOpen") {
        const anchor = state.anchors.find((candidate) => candidate.id === state.id);
        const ahead = anchor !== undefined && anchor.atDistanceM > event.progressM;
        return { phase: "idle", ...base, dismissed: ahead || dismissed.includes(state.id) ? dismissed : [...dismissed, state.id] };
      }
      return { phase: "idle", ...base };
    }
    case "dismissRequested":
      if ((state.phase !== "showing" && state.phase !== "mediaOpen") || state.id !== event.id) return state;
      return putAway(state, event.nowMs);
    case "mediaOpened":
      if (state.phase !== "showing" || state.id !== event.id) return state;
      return { phase: "mediaOpen", id: state.id, ...common(state) };
    case "mediaClosed":
      if (state.phase !== "mediaOpen" || state.id !== event.id) return state;
      return putAway(state, event.nowMs);
    default: {
      const unhandled: never = event;
      return unhandled;
    }
  }
}

export function momentPhaseOf(state: OverlandMomentsState, id: string): MomentPhase {
  if (state.phase !== "idle" && state.id === id) return state.phase;
  if (state.queue.includes(id)) return "approaching";
  if (state.dismissed.includes(id)) return "dismissed";
  return "idle";
}

/** How fast playback runs around a moment: slower near one, stopped while its photo is open. */
export function momentTimeScale(state: OverlandMomentsState) {
  switch (state.phase) {
    case "approaching":
      return 0.6;
    case "showing":
      return 0.35;
    case "mediaOpen":
      return 0;
    default:
      return 1;
  }
}
