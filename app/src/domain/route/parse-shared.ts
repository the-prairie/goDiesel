// Primitives shared by both parse tiers (ADR-0004).

import type { GeneratedQuestRoute, RoutePoint } from "@/domain/route/contract";

export const curationFields = [
  "vibe",
  "ideal_use",
  "terrain",
  "difficulty",
  "highlights",
  "caveats",
  "seasonality",
  "editorial_note",
] as const;
export const curationFieldSet = new Set<string>([...curationFields, "review_status"]);

export function optionalCurationText(source: Record<string, unknown>, field: string) {
  const value = source[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`curation.${field} must be a non-empty string`);
  }
  return value.trim();
}

export function optionalCurationList(source: Record<string, unknown>, field: string) {
  const value = source[field];
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== "string" || !item.trim())
  ) {
    throw new Error(`curation.${field} must be a list of non-empty strings`);
  }
  return value.map((item) => (item as string).trim());
}

export function numberValue(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

export function requiredSlug(input: GeneratedQuestRoute, context: string) {
  const slug = stringValue(input.slug, stringValue(input.activity_id)).trim();
  if (!slug) throw new Error(`${context} is missing slug`);
  return slug;
}

export function parsedRoutePoints(value: unknown) {
  if (!Array.isArray(value) || value.length < 2) {
    return { points: [] as RoutePoint[], status: "missing" as const };
  }

  const points: RoutePoint[] = [];
  let previousDistance = -1;
  let previousElapsed = -1;
  for (const point of value) {
    const source: Record<string, unknown> | undefined = Array.isArray(point)
      ? { lat: point[0], lng: point[1], elev: point[2], d: point[3] }
      : point !== null && typeof point === "object"
        ? (point as Record<string, unknown>)
        : undefined;
    const lat = source ? numberValue(source.lat, Number.NaN) : Number.NaN;
    const lng = source ? numberValue(source.lng, Number.NaN) : Number.NaN;
    const elev = source ? numberValue(source.elev, Number.NaN) : Number.NaN;
    const d = source ? numberValue(source.d, Number.NaN) : Number.NaN;
    const rawElapsed = source?.elapsed_s;
    const elapsedS =
      rawElapsed === undefined ? undefined : numberValue(rawElapsed, Number.NaN);

    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      !Number.isFinite(elev) ||
      !Number.isFinite(d) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180 ||
      d < 0 ||
      d < previousDistance ||
      (elapsedS !== undefined &&
        (!Number.isFinite(elapsedS) || elapsedS < 0 || elapsedS < previousElapsed))
    ) {
      return { points: [] as RoutePoint[], status: "invalid" as const };
    }
    points.push({ lat, lng, elev, d, ...(elapsedS !== undefined ? { elapsedS } : {}) });
    previousDistance = d;
    if (elapsedS !== undefined) previousElapsed = elapsedS;
  }

  return { points, status: "ready" as const };
}

export function validTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function generatedRoute(value: unknown, context: string): GeneratedQuestRoute {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }
  return value as GeneratedQuestRoute;
}
