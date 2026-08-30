// The strict tier (ADR-0004). Any contract violation throws.

import type { RouteLifecycle } from "@/domain/route/lifecycle";
import type { RouteElevationStatus } from "@/domain/route/contract";
import type { RouteAnnotation, RouteAnnotationMedia, GeneratedQuestRoute, QuestRoute, ReplayMetadata, RouteCuration, RouteGeometryStatus, RoutePoint, RouteProvenance, RouteDiscontinuityKind, RouteDiscontinuitySource, RouteTemporalProvenance } from "@/domain/route/contract";
import { curationFieldSet, curationFields, generatedRoute, optionalCurationList, optionalCurationText, parsedRoutePoints, requiredSlug, validTimeZone } from "@/domain/route/parse-shared";

function validatedElevationStatus(value: unknown): RouteElevationStatus {
  const status = value ?? "recorded";
  if (status !== "recorded" && status !== "unavailable") {
    throw new Error("elevation_status must be recorded or unavailable");
  }
  return status;
}

function validatedCuration(value: unknown): RouteCuration {
  if (value === undefined) return { reviewStatus: "draft" };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("curation must be an object");
  }

  const source = value as Record<string, unknown>;
  const unknownFields = Object.keys(source).filter((field) => !curationFieldSet.has(field));
  if (unknownFields.length > 0) {
    throw new Error(`curation has unknown fields: ${unknownFields.sort().join(", ")}`);
  }
  const reviewStatus = source.review_status ?? "draft";
  if (
    reviewStatus !== "draft" &&
    reviewStatus !== "reviewed" &&
    reviewStatus !== "published"
  ) {
    throw new Error("curation.review_status must be draft, reviewed, or published");
  }

  const curation: RouteCuration = {
    vibe: optionalCurationText(source, "vibe"),
    idealUse: optionalCurationText(source, "ideal_use"),
    terrain: optionalCurationList(source, "terrain"),
    difficulty: optionalCurationText(source, "difficulty"),
    highlights: optionalCurationList(source, "highlights"),
    caveats: optionalCurationList(source, "caveats"),
    seasonality: optionalCurationText(source, "seasonality"),
    editorialNote: optionalCurationText(source, "editorial_note"),
    reviewStatus,
  };

  if (reviewStatus !== "draft") {
    for (const field of curationFields) {
      if (source[field] === undefined) {
        throw new Error(`${reviewStatus} curation is missing ${field}`);
      }
    }
  }

  return Object.fromEntries(
    Object.entries(curation).filter(([, fieldValue]) => fieldValue !== undefined),
  ) as unknown as RouteCuration;
}

function validatedProvenance(
  value: unknown,
  route: RoutePoint[],
  elevationStatus: RouteElevationStatus,
): RouteProvenance {
  if (value === undefined) {
    return {
      temporal: { status: "unavailable" },
      elevation: { status: elevationStatus },
      track: { segmentCount: route.length > 0 ? 1 : 0 },
      discontinuities: [],
    };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("provenance must be an object");
  }
  const source = value as Record<string, unknown>;
  const elevationSource = source.elevation;
  const provenanceElevationStatus =
    elevationSource && typeof elevationSource === "object" && !Array.isArray(elevationSource)
      ? (elevationSource as Record<string, unknown>).status
      : elevationStatus;
  if (
    provenanceElevationStatus !== "recorded" &&
    provenanceElevationStatus !== "unavailable"
  ) {
    throw new Error("provenance.elevation.status must be recorded or unavailable");
  }
  if (provenanceElevationStatus !== elevationStatus) {
    throw new Error("provenance elevation must agree with elevation_status");
  }
  const temporalSource = source.temporal;
  if (!temporalSource || typeof temporalSource !== "object" || Array.isArray(temporalSource)) {
    throw new Error("provenance.temporal must be an object");
  }
  const temporalRecord = temporalSource as Record<string, unknown>;
  let temporal: RouteTemporalProvenance;
  if (temporalRecord.status === "unavailable") {
    temporal = { status: "unavailable" };
  } else if (temporalRecord.status === "recorded") {
    const startTimeUtc = temporalRecord.start_time_utc;
    const elapsedTimeS = temporalRecord.elapsed_time_s;
    const timeZone = temporalRecord.time_zone;
    if (
      typeof startTimeUtc !== "string" ||
      !startTimeUtc.endsWith("Z") ||
      !Number.isFinite(Date.parse(startTimeUtc))
    ) {
      throw new Error("recorded provenance requires a UTC start timestamp");
    }
    if (
      typeof elapsedTimeS !== "number" ||
      !Number.isFinite(elapsedTimeS) ||
      elapsedTimeS < 0
    ) {
      throw new Error("recorded provenance requires non-negative elapsed time");
    }
    if (timeZone !== undefined) {
      if (typeof timeZone !== "string" || !validTimeZone(timeZone)) {
        throw new Error("recorded provenance timezone must be a valid IANA timezone");
      }
    }
    temporal = {
      status: "recorded",
      startTimeUtc,
      elapsedTimeS,
      ...(typeof timeZone === "string" ? { timeZone } : {}),
    };
  } else {
    throw new Error("provenance.temporal.status must be recorded or unavailable");
  }

  const trackSource = source.track;
  if (!trackSource || typeof trackSource !== "object" || Array.isArray(trackSource)) {
    throw new Error("provenance.track must be an object");
  }
  const segmentCount = (trackSource as Record<string, unknown>).segment_count;
  if (
    typeof segmentCount !== "number" ||
    !Number.isInteger(segmentCount) ||
    segmentCount < 0
  ) {
    throw new Error("provenance.track.segment_count must be a non-negative integer");
  }

  if (!Array.isArray(source.discontinuities)) {
    throw new Error("provenance.discontinuities must be an array");
  }
  const totalDistance = route.at(-1)?.d ?? 0;
  const expectedSources: Record<RouteDiscontinuityKind, RouteDiscontinuitySource> = {
    segment_boundary: "recorded_track_segment",
    recording_gap: "recorded_timestamps",
    missing_position_records: "recorded_position_absence",
  };
  const discontinuities = source.discontinuities.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("provenance discontinuity must be an object");
    }
    const record = item as Record<string, unknown>;
    const kind = record.kind as RouteDiscontinuityKind;
    const evidenceSource = record.source as RouteDiscontinuitySource;
    if (!(kind in expectedSources) || expectedSources[kind] !== evidenceSource) {
      throw new Error("provenance discontinuity kind and source do not agree");
    }
    const startD = record.start_d;
    const endD = record.end_d;
    if (
      typeof startD !== "number" ||
      !Number.isFinite(startD) ||
      typeof endD !== "number" ||
      !Number.isFinite(endD) ||
      startD < 0 ||
      endD < startD
    ) {
      throw new Error("provenance discontinuity distance is invalid");
    }
    if (route.length > 0 && endD > totalDistance) {
      throw new Error("provenance discontinuity exceeds route distance");
    }
    const elapsedTimeS = record.elapsed_time_s;
    if (
      elapsedTimeS !== undefined &&
      (typeof elapsedTimeS !== "number" || !Number.isFinite(elapsedTimeS) || elapsedTimeS < 0)
    ) {
      throw new Error("provenance discontinuity elapsed time is invalid");
    }
    const missingRecordCount = record.missing_record_count;
    if (
      missingRecordCount !== undefined &&
      (typeof missingRecordCount !== "number" ||
        !Number.isInteger(missingRecordCount) ||
        missingRecordCount < 1)
    ) {
      throw new Error("provenance missing record count is invalid");
    }
    return {
      kind,
      source: evidenceSource,
      startD,
      endD,
      ...(elapsedTimeS !== undefined ? { elapsedTimeS } : {}),
      ...(missingRecordCount !== undefined ? { missingRecordCount } : {}),
    };
  });

  return {
    temporal,
    elevation: { status: provenanceElevationStatus },
    track: { segmentCount },
    discontinuities,
  };
}

function requiredStringField(
  input: GeneratedQuestRoute,
  field: keyof GeneratedQuestRoute,
  allowEmpty = true,
) {
  const value = input[field];
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) {
    throw new Error(`${String(field)} must be a string${allowEmpty ? "" : " with content"}`);
  }
  return value;
}

function requiredNumberField(
  input: GeneratedQuestRoute,
  field: keyof GeneratedQuestRoute,
  options: { min?: number; max?: number; integer?: boolean } = {},
) {
  const value = input[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${String(field)} must be a finite number`);
  }
  if (options.min !== undefined && value < options.min) {
    throw new Error(`${String(field)} must be at least ${options.min}`);
  }
  if (options.max !== undefined && value > options.max) {
    throw new Error(`${String(field)} must be at most ${options.max}`);
  }
  if (options.integer && !Number.isInteger(value)) {
    throw new Error(`${String(field)} must be an integer`);
  }
  return value;
}

function validatedReplayMetadata(
  value: unknown,
  lifecycle: RouteLifecycle,
  geometryStatus: RouteGeometryStatus,
): ReplayMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("replay must be an object");
  }
  const source = value as Record<string, unknown>;
  if (source.mode !== "atlas" && source.mode !== "earth") {
    throw new Error("replay.mode must be atlas or earth");
  }
  if (typeof source.replay_eligible !== "boolean") {
    throw new Error("replay.replay_eligible must be a boolean");
  }
  if (typeof source.best_in_earth !== "boolean") {
    throw new Error("replay.best_in_earth must be a boolean");
  }
  if (source.geometry_status !== "ready" && source.geometry_status !== "missing") {
    throw new Error("replay.geometry_status must be ready or missing");
  }
  if (source.best_in_earth && source.mode !== "earth") {
    throw new Error("best_in_earth replay must use earth mode");
  }

  return {
    replayMode: source.mode,
    replayEligible:
      lifecycle !== "planned" && geometryStatus === "ready" && source.replay_eligible,
    bestInEarth: source.best_in_earth,
    geometryStatus,
  };
}

function validatedDetailFields(
  input: GeneratedQuestRoute,
  slug: string,
  geometryStatus: RouteGeometryStatus,
) {
  const lifecycleValue = input.lifecycle;
  if (
    lifecycleValue !== "completed" &&
    lifecycleValue !== "planned" &&
    lifecycleValue !== "discovered"
  ) {
    throw new Error("lifecycle must be completed, planned, or discovered");
  }
  const lifecycle = lifecycleValue as RouteLifecycle;
  const elevationStatus = validatedElevationStatus(input.elevation_status);

  return {
    slug,
    activityId: requiredStringField(input, "activity_id", false),
    lifecycle,
    name: requiredStringField(input, "name", false),
    subtitle: requiredStringField(input, "subtitle"),
    activityName: requiredStringField(input, "activity_name"),
    region: requiredStringField(input, "region", false),
    date: requiredStringField(input, "date"),
    distanceKm: requiredNumberField(input, "distance_km", { min: 0 }),
    elevationGainM: requiredNumberField(input, "elevation_gain_m", { min: 0 }),
    elevationStatus,
    type: requiredStringField(input, "type", false),
    description: requiredStringField(input, "description"),
    completionRule: requiredStringField(input, "completion_rule"),
    difficulty: requiredStringField(input, "difficulty", false),
    theme: requiredStringField(input, "theme", false),
    xp: requiredNumberField(input, "xp", { min: 0 }),
    centerLat: requiredNumberField(input, "center_lat", { min: -90, max: 90 }),
    centerLng: requiredNumberField(input, "center_lng", { min: -180, max: 180 }),
    replay: validatedReplayMetadata(input.replay, lifecycle, geometryStatus),
    curation: validatedCuration(input.curation),
  };
}

const ANNOTATION_KINDS = new Set(["note", "landmark", "warning", "image"]);
const ANNOTATION_EVIDENCE = new Set([
  "recorded",
  "derived",
  "measured",
  "hypothesis",
]);
const ANNOTATION_FIELDS = new Set([
  "id",
  "at_distance_m",
  "kind",
  "evidence",
  "body",
  "title",
  "media",
]);
const MEDIA_FIELDS = new Set(["url", "thumb_url", "width", "height"]);

function validatedMedia(value: unknown, id: string): RouteAnnotationMedia {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`annotation ${id} media must be an object`);
  }
  const source = value as Record<string, unknown>;
  const unknown = Object.keys(source).filter((field) => !MEDIA_FIELDS.has(field));
  if (unknown.length > 0) {
    throw new Error(`annotation ${id} media has unknown fields: ${unknown.sort().join(", ")}`);
  }
  const url = source.url;
  const thumbUrl = source.thumb_url;
  // A published path only. An annotation must never reference a file outside
  // the published media directory.
  for (const [field, candidate] of [["url", url], ["thumb_url", thumbUrl]] as const) {
    if (typeof candidate !== "string" || !candidate.startsWith("media/")) {
      throw new Error(`annotation ${id} media ${field} must be a published media path`);
    }
  }
  const width = source.width;
  const height = source.height;
  for (const [field, candidate] of [["width", width], ["height", height]] as const) {
    if (typeof candidate !== "number" || !Number.isInteger(candidate) || candidate <= 0) {
      throw new Error(`annotation ${id} media ${field} must be a positive integer`);
    }
  }
  return {
    url: url as string,
    thumbUrl: thumbUrl as string,
    width: width as number,
    height: height as number,
  };
}

/**
 * Annotations are anchored to the recorded trace, so an anchor that does not
 * fall on the route is a contract violation rather than a rendering problem.
 * The generator sorts by anchor; the strict tier verifies that order survived.
 */
function validatedAnnotations(
  value: unknown,
  route: RoutePoint[],
): RouteAnnotation[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("annotations must be an array");

  const totalDistance = route.at(-1)?.d ?? 0;
  const seen = new Set<string>();
  let previousDistance = -1;

  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("annotation must be an object");
    }
    const source = item as Record<string, unknown>;
    const unknownFields = Object.keys(source).filter(
      (field) => !ANNOTATION_FIELDS.has(field),
    );
    if (unknownFields.length > 0) {
      throw new Error(
        `annotation has unknown fields: ${unknownFields.sort().join(", ")}`,
      );
    }

    const id = source.id;
    if (typeof id !== "string" || !id.trim()) {
      throw new Error("annotation id must be a non-empty string");
    }
    if (seen.has(id)) throw new Error(`annotation id ${id} is duplicated`);
    seen.add(id);

    const kind = source.kind;
    if (typeof kind !== "string" || !ANNOTATION_KINDS.has(kind)) {
      throw new Error(`annotation ${id} has an unknown kind`);
    }
    const evidence = source.evidence;
    if (typeof evidence !== "string" || !ANNOTATION_EVIDENCE.has(evidence)) {
      throw new Error(`annotation ${id} has an unknown evidence label`);
    }

    const atDistanceM = source.at_distance_m;
    if (
      typeof atDistanceM !== "number" ||
      !Number.isFinite(atDistanceM) ||
      atDistanceM < 0 ||
      (route.length > 0 && atDistanceM > totalDistance)
    ) {
      throw new Error(`annotation ${id} does not fall on the recorded route`);
    }
    if (atDistanceM < previousDistance) {
      throw new Error("annotations must be ordered by distance travelled");
    }
    previousDistance = atDistanceM;

    const body = source.body;
    if (typeof body !== "string" || !body.trim()) {
      throw new Error(`annotation ${id} body must be a non-empty string`);
    }
    const media = source.media;
    if (kind === "image" && media === undefined) {
      throw new Error(`annotation ${id} of kind image requires media`);
    }

    const title = source.title;
    if (title !== undefined && (typeof title !== "string" || !title.trim())) {
      throw new Error(`annotation ${id} title must be a non-empty string`);
    }

    return {
      id,
      atDistanceM,
      kind: kind as RouteAnnotation["kind"],
      evidence: evidence as RouteAnnotation["evidence"],
      body,
      ...(typeof title === "string" ? { title } : {}),
      ...(media !== undefined ? { media: validatedMedia(media, id) } : {}),
    };
  });
}

export function parseRouteDetail(value: unknown): QuestRoute {
  const input = generatedRoute(value, "Route detail");
  const slug = requiredSlug(input, "Route detail");
  const elevationStatus = validatedElevationStatus(input.elevation_status);
  const parsedRoute = parsedRoutePoints(input.route, elevationStatus);
  const route = parsedRoute.points;
  const geometryStatus = parsedRoute.status;
  const midIdx = requiredNumberField(input, "mid_idx", { min: 0, integer: true });
  if (geometryStatus === "ready" && midIdx >= route.length) {
    throw new Error("mid_idx must reference a route point");
  }

  return {
    ...validatedDetailFields(input, slug, geometryStatus),
    route,
    midIdx,
    annotations: validatedAnnotations(input.annotations, route),
    provenance: validatedProvenance(input.provenance, route, elevationStatus),
  };
}
