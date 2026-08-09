// Route grounding reconciles recorded elevation against provider mesh height.
// CONTEXT.md section 7: recorded elevation is the truth and the provider supplies
// only a bounded corrective offset. Extracted from the Playable Earth lab
// controller so the production replay engines do not depend on a lab module
// (ADR-0008).

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function approach(value: number, target: number, amount: number) {
  if (value < target) return Math.min(target, value + amount);
  return Math.max(target, value - amount);
}

export type RouteGroundingSource = "fallback" | "sampled";
export type RouteGroundingReason =
  | "recorded"
  | "sampled"
  | "missing"
  | "outlier";

export type RouteGroundingObservation =
  | { kind: "sample"; heightM: number }
  | { kind: "missing" };

export interface RouteGroundingState {
  displayedHeightM: number;
  stableOffsetM?: number;
  source: RouteGroundingSource;
  reason: RouteGroundingReason;
}


const MAX_INITIAL_SURFACE_OFFSET_M = 300;
const MAX_SURFACE_OFFSET_CHANGE_M = 15;
const MAX_GROUNDING_SPEED_M_PER_SECOND = 24;

export function initialRouteGrounding(
  recordedHeightM: number,
): RouteGroundingState {
  return {
    displayedHeightM: recordedHeightM,
    source: "fallback",
    reason: "recorded",
  };
}

export function advanceRouteGrounding(
  state: RouteGroundingState,
  recordedHeightM: number,
  elapsedSeconds: number,
  observation?: RouteGroundingObservation,
): RouteGroundingState {
  let source = state.source;
  let reason = state.reason;
  let stableOffsetM = state.stableOffsetM;

  if (observation?.kind === "missing") {
    source = "fallback";
    reason = "missing";
  } else if (observation?.kind === "sample") {
    const sampledOffsetM = observation.heightM - recordedHeightM;
    const plausibleInitialOffset =
      Number.isFinite(sampledOffsetM) &&
      Math.abs(sampledOffsetM) <= MAX_INITIAL_SURFACE_OFFSET_M;
    const plausibleOffsetChange =
      stableOffsetM === undefined ||
      Math.abs(sampledOffsetM - stableOffsetM) <= MAX_SURFACE_OFFSET_CHANGE_M;

    if (plausibleInitialOffset && plausibleOffsetChange) {
      stableOffsetM =
        stableOffsetM === undefined
          ? sampledOffsetM
          : stableOffsetM + (sampledOffsetM - stableOffsetM) * 0.25;
      source = "sampled";
      reason = "sampled";
    } else {
      source = "fallback";
      reason = "outlier";
    }
  }

  const targetHeightM =
    source === "sampled" && stableOffsetM !== undefined
      ? recordedHeightM + stableOffsetM
      : recordedHeightM;
  const elapsed = clamp(elapsedSeconds, 0, 0.25);
  const displayedHeightM = approach(
    state.displayedHeightM,
    targetHeightM,
    MAX_GROUNDING_SPEED_M_PER_SECOND * elapsed,
  );

  return {
    displayedHeightM,
    stableOffsetM,
    source,
    reason,
  };
}

