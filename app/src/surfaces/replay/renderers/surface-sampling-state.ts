export const SURFACE_SAMPLE_INTERVAL_MS = 250;

type SamplingClock = { requestId: number; lastStartedAtMs: number };
export type SurfaceSamplingState = SamplingClock &
  (
    | { phase: "idle" }
    | { phase: "sampling"; retryLatest: boolean }
    | { phase: "disposed" }
  );

export type SurfaceSamplingEvent =
  | { type: "sessionStarted" }
  | { type: "sampleRequested"; atMs: number; supported: boolean }
  | { type: "sampleObserved"; requestId: number; retryLatest: boolean }
  | { type: "sampleFailed"; requestId: number }
  | { type: "sampleCompleted"; requestId: number }
  | { type: "disposed" };

export function initialSurfaceSamplingState(): SurfaceSamplingState {
  return {
    phase: "idle",
    requestId: 0,
    lastStartedAtMs: Number.NEGATIVE_INFINITY,
  };
}

export function reduceSurfaceSampling(
  state: SurfaceSamplingState,
  event: SurfaceSamplingEvent,
): SurfaceSamplingState {
  switch (event.type) {
    case "sessionStarted":
      return state.phase === "disposed" ? { ...state, phase: "idle" } : state;
    case "disposed":
      return {
        phase: "disposed",
        requestId: state.requestId + 1,
        lastStartedAtMs: Number.NEGATIVE_INFINITY,
      };
    case "sampleRequested": {
      if (
        state.phase !== "idle" ||
        event.atMs - state.lastStartedAtMs < SURFACE_SAMPLE_INTERVAL_MS
      )
        return state;
      const clock = {
        requestId: state.requestId + 1,
        lastStartedAtMs: event.atMs,
      };
      return event.supported
        ? { ...clock, phase: "sampling", retryLatest: false }
        : { ...clock, phase: "idle" };
    }
    case "sampleObserved":
    case "sampleFailed":
      if (state.phase !== "sampling" || state.requestId !== event.requestId)
        return state;
      return {
        ...state,
        retryLatest: event.type === "sampleFailed" || event.retryLatest,
      };
    case "sampleCompleted":
      if (state.phase !== "sampling" || state.requestId !== event.requestId)
        return state;
      return {
        phase: "idle",
        requestId: state.requestId,
        lastStartedAtMs: state.lastStartedAtMs,
      };
  }
}

export function surfaceSampleRetryDelay(
  state: SurfaceSamplingState,
  nowMs: number,
) {
  return Math.max(
    0,
    SURFACE_SAMPLE_INTERVAL_MS - (nowMs - state.lastStartedAtMs),
  );
}
