// The lenient tier (ADR-0004). A bad manifest entry must not break the app.

import { normalizeRouteLifecycle, type RouteLifecycle } from "@/domain/route/lifecycle";
import type { GeneratedQuestRoute, ReplayMetadata, RouteElevationStatus, RouteGeometryStatus, RouteGuidePreview, RouteSummary } from "@/domain/route/contract";
import { generatedRoute, numberValue, parsedRoutePoints, requiredSlug, stringValue } from "@/domain/route/parse-shared";

function validatedGuidePreview(value: unknown): RouteGuidePreview {
  if (value === undefined) return { reviewStatus: "draft" };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("guide_preview must be an object");
  }

  const source = value as Record<string, unknown>;
  const unknownFields = Object.keys(source).filter(
    (field) => field !== "vibe" && field !== "review_status",
  );
  if (unknownFields.length > 0) {
    throw new Error(
      `guide_preview has unknown fields: ${unknownFields.sort().join(", ")}`,
    );
  }

  const reviewStatus = source.review_status ?? "draft";
  if (
    reviewStatus !== "draft" &&
    reviewStatus !== "reviewed" &&
    reviewStatus !== "published"
  ) {
    throw new Error(
      "guide_preview.review_status must be draft, reviewed, or published",
    );
  }
  const vibe = source.vibe;
  if (vibe !== undefined && (typeof vibe !== "string" || !vibe.trim())) {
    throw new Error("guide_preview.vibe must be a non-empty string");
  }
  if (reviewStatus !== "draft" && vibe === undefined) {
    throw new Error(`${reviewStatus} guide_preview is missing vibe`);
  }

  return {
    ...(typeof vibe === "string" ? { vibe: vibe.trim() } : {}),
    reviewStatus,
  };
}

function replayMetadata(
  value: unknown,
  lifecycle: RouteLifecycle,
  geometryStatus: RouteGeometryStatus,
): ReplayMetadata {
  const source =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const bestInEarth = source.best_in_earth === true;
  const replayMode = source.mode === "earth" || bestInEarth ? "earth" : "atlas";
  const replayRequested = source.replay_eligible !== false;

  return {
    replayMode,
    replayEligible:
      lifecycle !== "planned" && geometryStatus === "ready" && replayRequested,
    bestInEarth,
    geometryStatus,
  };
}

function commonRouteFields(
  input: GeneratedQuestRoute,
  slug: string,
  geometryStatus: RouteGeometryStatus,
) {
  const lifecycle = normalizeRouteLifecycle(input.lifecycle ?? input.status);
  const elevationStatus: RouteElevationStatus =
    input.elevation_status === "unavailable" ? "unavailable" : "recorded";

  return {
    slug,
    activityId: stringValue(input.activity_id, slug),
    lifecycle,
    name: stringValue(input.name, "Untitled route"),
    subtitle: stringValue(input.subtitle),
    activityName: stringValue(input.activity_name),
    region: stringValue(input.region, "Unknown region"),
    date: stringValue(input.date),
    distanceKm: numberValue(input.distance_km),
    elevationGainM:
      elevationStatus === "unavailable" ? null : numberValue(input.elevation_gain_m),
    elevationStatus,
    type: stringValue(input.type, "Run"),
    description: stringValue(input.description),
    completionRule: stringValue(input.completion_rule),
    difficulty: stringValue(input.difficulty, "Open"),
    theme: stringValue(input.theme, "Quest"),
    xp: numberValue(input.xp),
    centerLat: numberValue(input.center_lat),
    centerLng: numberValue(input.center_lng),
    replay: replayMetadata(input.replay, lifecycle, geometryStatus),
  };
}

export function parseRouteSummary(value: unknown): RouteSummary {
  const input = generatedRoute(value, "Route summary");
  const slug = requiredSlug(input, "Route summary");
  const elevationStatus: RouteElevationStatus =
    input.elevation_status === "unavailable" ? "unavailable" : "recorded";
  const parsedTrace = parsedRoutePoints(input.trace, elevationStatus);
  const trace = parsedTrace.points;
  const geometryStatus =
    input.replay &&
    typeof input.replay === "object" &&
    (input.replay as Record<string, unknown>).geometry_status === "missing"
      ? "missing"
      : parsedTrace.status;

  return {
    ...commonRouteFields(input, slug, geometryStatus),
    trace,
    guide: validatedGuidePreview(input.guide_preview),
    centerLat: numberValue(input.center_lat, trace[0]?.lat ?? 0),
    centerLng: numberValue(input.center_lng, trace[0]?.lng ?? 0),
  };
}
