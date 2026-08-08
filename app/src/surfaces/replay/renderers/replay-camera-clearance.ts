export const REPLAY_CAMERA_MIN_CLEARANCE_M = 45;

const MIN_PLAUSIBLE_SURFACE_HEIGHT_M = -500;
const MAX_PLAUSIBLE_SURFACE_HEIGHT_M = 10_000;
const MAX_CAMERA_DESCENT_M_PER_SECOND = 120;

export type ReplayCameraSurfaceObservation =
  | { kind: "sample"; heightM: number }
  | { kind: "missing" };

export interface ReplayCameraClearanceState {
  altitudeM: number;
  lastValidSurfaceHeightM?: number;
}

export function initialReplayCameraClearance(
  altitudeM: number,
): ReplayCameraClearanceState {
  return { altitudeM };
}

export function advanceReplayCameraClearance(
  state: ReplayCameraClearanceState,
  baseAltitudeM: number,
  elapsedSeconds: number,
  observation?: ReplayCameraSurfaceObservation,
  minimumClearanceM = REPLAY_CAMERA_MIN_CLEARANCE_M,
): ReplayCameraClearanceState {
  const sampledHeightM =
    observation?.kind === "sample" &&
    Number.isFinite(observation.heightM) &&
    observation.heightM >= MIN_PLAUSIBLE_SURFACE_HEIGHT_M &&
    observation.heightM <= MAX_PLAUSIBLE_SURFACE_HEIGHT_M
      ? observation.heightM
      : undefined;
  const lastValidSurfaceHeightM = sampledHeightM ?? state.lastValidSurfaceHeightM;
  const validSample = sampledHeightM !== undefined;
  const sampledFloorM = lastValidSurfaceHeightM === undefined
      ? Number.NEGATIVE_INFINITY
      : lastValidSurfaceHeightM + minimumClearanceM;
  const targetAltitudeM = Math.max(baseAltitudeM, sampledFloorM);

  if (
    sampledHeightM !== undefined && state.lastValidSurfaceHeightM === undefined
  ) {
    return { altitudeM: targetAltitudeM, lastValidSurfaceHeightM };
  }

  if (
    observation !== undefined && !validSample
  ) {
    return {
      altitudeM: Math.max(state.altitudeM, baseAltitudeM),
      lastValidSurfaceHeightM,
    };
  }

  if (targetAltitudeM >= state.altitudeM) {
    return { altitudeM: targetAltitudeM, lastValidSurfaceHeightM };
  }

  const descentM =
    MAX_CAMERA_DESCENT_M_PER_SECOND * Math.min(0.25, Math.max(0, elapsedSeconds));
  return {
    altitudeM: Math.max(targetAltitudeM, state.altitudeM - descentM),
    lastValidSurfaceHeightM,
  };
}

export function replayCameraClearanceM(state: ReplayCameraClearanceState) {
  return state.lastValidSurfaceHeightM === undefined
    ? undefined
    : state.altitudeM - state.lastValidSurfaceHeightM;
}
