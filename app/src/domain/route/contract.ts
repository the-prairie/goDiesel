// The route contract, per CONTEXT.md section 2. Types, plus the climb accessors
// that keep an unknown climb from reading as zero.

import type { RouteLifecycle } from "@/domain/route/lifecycle";
import { curationFields } from "@/domain/route/parse-shared";

export type RouteActivityType = "Run" | "Ride" | string;
export type RouteGeometryStatus = "ready" | "missing" | "invalid";
/**
 * Whether the source recorded elevation. Absent in generated data means
 * `recorded`: every record generated before this field existed has a recorded
 * gain. `unavailable` routes carry `elevation_gain_m: null`.
 */
export type RouteElevationStatus = "recorded" | "unavailable";

export interface RoutePoint {
  lat: number;
  lng: number;
  elev: number;
  d: number;
  elapsedS?: number;
}

export interface RouteTemporalProvenance {
  status: "recorded" | "unavailable";
  startTimeUtc?: string;
  elapsedTimeS?: number;
  timeZone?: string;
}

export type RouteDiscontinuityKind =
  | "segment_boundary"
  | "recording_gap"
  | "missing_position_records";

export type RouteDiscontinuitySource =
  | "recorded_track_segment"
  | "recorded_timestamps"
  | "recorded_position_absence";

export interface RouteDiscontinuityEvidence {
  kind: RouteDiscontinuityKind;
  source: RouteDiscontinuitySource;
  startD: number;
  endD: number;
  elapsedTimeS?: number;
  missingRecordCount?: number;
}

export interface RouteProvenance {
  temporal: RouteTemporalProvenance;
  track: { segmentCount: number };
  discontinuities: RouteDiscontinuityEvidence[];
}

export interface ReplayMetadata {
  replayMode: "earth" | "atlas";
  replayEligible: boolean;
  bestInEarth: boolean;
  geometryStatus: RouteGeometryStatus;
}

export type RouteAnnotationKind = "note" | "landmark" | "warning" | "image";

/**
 * How much the product knows about a value. CONTEXT.md section 4.
 * Editorial interpretation is `hypothesis` and must be marked as such.
 */
export type RouteAnnotationEvidence =
  | "recorded"
  | "derived"
  | "measured"
  | "hypothesis";

/**
 * Editorial content pinned to a distance along the recorded trace. One anchor
 * drives the guide margin, Replay, and the cinematic director.
 */
/** A published image. EXIF is stripped before publication. */
export interface RouteAnnotationMedia {
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
}

export interface RouteAnnotation {
  id: string;
  atDistanceM: number;
  kind: RouteAnnotationKind;
  evidence: RouteAnnotationEvidence;
  body: string;
  title?: string;
  media?: RouteAnnotationMedia;
}

export type CurationReviewStatus = "draft" | "reviewed" | "published";

export interface RouteCuration {
  vibe?: string;
  idealUse?: string;
  terrain?: string[];
  difficulty?: string;
  highlights?: string[];
  caveats?: string[];
  seasonality?: string;
  editorialNote?: string;
  reviewStatus: CurationReviewStatus;
}

export interface RouteGuidePreview {
  vibe?: string;
  reviewStatus: CurationReviewStatus;
}

export interface RouteSummary {
  slug: string;
  activityId: string;
  lifecycle: RouteLifecycle;
  name: string;
  subtitle: string;
  activityName: string;
  region: string;
  date: string;
  distanceKm: number;
  /**
   * Recorded climb. It is 0, not a measurement, when `elevationStatus` is
   * `unavailable`; present it through `recordedClimbM` or `climbLabel`.
   */
  elevationGainM: number;
  /** Set by both parsers. Optional so hand-built routes default to recorded. */
  elevationStatus?: RouteElevationStatus;
  type: RouteActivityType;
  description: string;
  completionRule: string;
  effortTier: string;
  theme: string;
  xp: number;
  trace: RoutePoint[];
  centerLat: number;
  centerLng: number;
  replay: ReplayMetadata;
  guide: RouteGuidePreview;
}

export interface QuestRoute extends Omit<RouteSummary, "trace" | "guide"> {
  route: RoutePoint[];
  midIdx: number;
  curation: RouteCuration;
  annotations: RouteAnnotation[];
  provenance: RouteProvenance;
}

export interface GeneratedQuestRoute {
  slug?: unknown;
  activity_id?: unknown;
  lifecycle?: unknown;
  status?: unknown;
  name?: unknown;
  subtitle?: unknown;
  activity_name?: unknown;
  region?: unknown;
  date?: unknown;
  distance_km?: unknown;
  elevation_gain_m?: unknown;
  elevation_status?: unknown;
  type?: unknown;
  description?: unknown;
  completion_rule?: unknown;
  effort_tier?: unknown;
  theme?: unknown;
  xp?: unknown;
  trace?: unknown;
  route?: unknown;
  center_lat?: unknown;
  center_lng?: unknown;
  mid_idx?: unknown;
  replay?: unknown;
  curation?: unknown;
  guide_preview?: unknown;
  annotations?: unknown;
  provenance?: unknown;
}

export const CURATION_FIELDS = curationFields;

type ClimbFields = Pick<RouteSummary, "elevationGainM" | "elevationStatus">;

/** The recorded climb in metres, or null when the source recorded no elevation. */
export function recordedClimbM(route: ClimbFields): number | null {
  return route.elevationStatus === "unavailable" ? null : route.elevationGainM;
}

export const CLIMB_NOT_RECORDED = "Climb not recorded";

/** "1,240 m up", or "Climb not recorded". Never a zero climb for unknown elevation. */
export function climbLabel(route: ClimbFields, unit = "m up"): string {
  const climbM = recordedClimbM(route);
  return climbM === null ? CLIMB_NOT_RECORDED : `${climbM.toLocaleString()} ${unit}`;
}
