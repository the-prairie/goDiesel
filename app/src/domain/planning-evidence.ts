// What Finder can honestly say about a candidate against a plan.
//
// Every route has recorded distance and elevation; almost none has reviewed
// experiential curation, and Finder's terrain and feeling words are the
// owner's tags, not measurements. So comparisons are measured, tags stay
// tags, and the attributes a recording cannot establish are named.

import type { DiscoveryCandidate, FinderIntent } from "@/domain/planning";
import type { RouteAnnotationEvidence } from "@/domain/route";

export const NOT_JUDGED_FROM_A_RECORDING = ["surface", "difficulty", "safety", "current access", "solitude"] as const;

export interface MeasuredComparison {
  label: string;
  value: string;
  /** Every value here is computed from the recording by build.py, so "derived". */
  evidence?: Extract<RouteAnnotationEvidence, "derived">;
  /** How this value was obtained, for assistive technology and tooltips. */
  explanation: string;
  note?: string;
}

function distanceNote(distanceKm: number, targetKm: number) {
  if (!(targetKm > 0)) return undefined;
  const delta = distanceKm - targetKm;
  if (Math.abs(delta) < 0.05) return `the same as your ${targetKm} km`;
  return `${Math.abs(delta).toFixed(1)} km ${delta > 0 ? "longer" : "shorter"} than your ${targetKm} km`;
}

export function groundedComparison(candidate: DiscoveryCandidate, intent: FinderIntent) {
  const route = candidate.route;
  const climbKnown = route.elevationStatus !== "unavailable" && typeof route.elevationGainM === "number";
  const note = distanceNote(route.distanceKm, intent.distanceKm);
  // build.py derives distance from the accumulated coordinate steps and climb
  // from elevation deltas; neither is a value the recording itself states.
  const unavailable = "Unavailable: this recording has no recorded elevation.";
  const measured: MeasuredComparison[] = [
    {
      label: "Distance", value: `${route.distanceKm.toFixed(1)} km`, evidence: "derived", note,
      explanation: "Derived from the recorded track's coordinates.",
    },
    climbKnown
      ? {
          label: "Climb", value: `${Math.round(route.elevationGainM!).toLocaleString()} m`, evidence: "derived",
          explanation: "Derived from the recorded elevations.",
        }
      : { label: "Climb", value: "Unavailable", explanation: unavailable },
    climbKnown && route.distanceKm > 0
      ? {
          label: "Climb rate", value: `${Math.round(route.elevationGainM! / route.distanceKm)} m/km`, evidence: "derived",
          explanation: "Derived from climb and distance.",
        }
      : { label: "Climb rate", value: "Unavailable", explanation: unavailable },
  ];
  const ownerTags = [...new Set([...candidate.terrain, ...candidate.vibes])];
  const reasons = [
    note ? `${route.distanceKm.toFixed(1)} km, ${note}` : `${route.distanceKm.toFixed(1)} km`,
    intent.terrain !== "any" && candidate.terrain.includes(intent.terrain) ? `the owner tagged it ${intent.terrain}` : undefined,
    intent.vibe ? `the owner's words include "${intent.vibe}"` : undefined,
  ].filter(Boolean);
  return {
    measured,
    ownerTags,
    notJudged: NOT_JUDGED_FROM_A_RECORDING,
    matchReason: `${reasons.join("; ")}.`,
  };
}
