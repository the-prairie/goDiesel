import { routes } from "@/data/routes";
import { loadRouteDetail } from "@/data/route-repository";
import {
  emptyCurationDraft,
  toCurationPayload,
  type AdminRouteRecord,
  type CurationDraft,
} from "@/domain/admin-curation";
import type { RouteCuration } from "@/domain/routes";

const adminApiBase =
  import.meta.env.VITE_ADMIN_API_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:8766";

export type AdminWorkspace =
  | {
      mode: "editable";
      generationStatus: string;
      generatedAt: string | null;
      routes: AdminRouteRecord[];
    }
  | {
      mode: "read-only";
      generationStatus: "bundled";
      generatedAt: null;
      routes: AdminRouteRecord[];
    };

export async function loadAdminWorkspace(): Promise<AdminWorkspace> {
  try {
    const [statusResponse, routesResponse] = await Promise.all([
      fetchWithTimeout(`${adminApiBase}/api/admin/status`),
      fetchWithTimeout(`${adminApiBase}/api/routes`),
    ]);
    if (!statusResponse.ok || !routesResponse.ok) throw new Error("Admin writer unavailable");
    const status = (await statusResponse.json()) as Record<string, unknown>;
    if (status.writer_available !== true) throw new Error("Admin writer unavailable");
    const records = await routesResponse.json();
    if (!Array.isArray(records)) throw new Error("Admin route list is invalid");
    return {
      mode: "editable",
      generationStatus: stringValue(status.generation_status, "unknown"),
      generatedAt: typeof status.generated_at === "string" ? status.generated_at : null,
      routes: records.map(parseAdminRoute),
    };
  } catch {
    return {
      mode: "read-only",
      generationStatus: "bundled",
      generatedAt: null,
      routes: routes
        .map((route) => ({
          activityId: route.activityId,
          name: route.name,
          region: route.region,
          date: route.date,
          type: route.type,
          distanceKm: route.distanceKm,
          sourceStatus: route.lifecycle,
          curation: {
            ...emptyCurationDraft,
            vibe: route.guide.vibe ?? "",
            reviewStatus: route.guide.reviewStatus,
          },
          geometryStatus: route.replay.geometryStatus,
          replayEligible: route.replay.replayEligible,
          generationStatus: "ready" as const,
        }))
        .sort((first, second) => {
          const statusDifference = reviewRank(first) - reviewRank(second);
          return statusDifference || second.date.localeCompare(first.date);
        }),
    };
  }
}

function reviewRank(route: AdminRouteRecord) {
  return route.curation.reviewStatus === "draft" ? 1 : 0;
}

export async function loadBundledCuration(record: AdminRouteRecord) {
  const result = await loadRouteDetail(record.activityId);
  return result.status === "ready" ? curationFromRoute(result.route.curation) : record.curation;
}

export async function saveAdminCuration(activityId: string, draft: CurationDraft) {
  const response = await fetch(`${adminApiBase}/api/curation/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ activity_id: activityId, curation: toCurationPayload(draft) }),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(stringValue(body.error, `Save failed with status ${response.status}.`));
  }
  return body;
}

function parseAdminRoute(value: unknown): AdminRouteRecord {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const replayEligible = source.replay_eligible === true;
  const geometryStatus =
    source.geometry_status === "ready" ||
    source.geometry_status === "invalid" ||
    source.geometry_status === "missing"
      ? source.geometry_status
      : "missing";
  const generationStatus =
    source.generation_status === "ready" ||
    source.generation_status === "building" ||
    source.generation_status === "failed"
      ? source.generation_status
      : "missing";

  return {
    activityId: stringValue(source.activity_id),
    name: stringValue(source.name, "Unnamed route"),
    region: stringValue(source.region) || stringValue(source.auto_region, "Unknown region"),
    date: stringValue(source.date),
    type: stringValue(source.type),
    distanceKm: numberValue(source.distance_km),
    sourceStatus: stringValue(source.status, "pending"),
    curation: parseCuration(source.curation),
    geometryStatus,
    replayEligible,
    generationStatus,
  };
}

function parseCuration(value: unknown): CurationDraft {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const reviewStatus =
    source.review_status === "reviewed" || source.review_status === "published"
      ? source.review_status
      : "draft";
  return {
    vibe: stringValue(source.vibe),
    idealUse: stringValue(source.ideal_use),
    terrain: stringList(source.terrain),
    difficulty: stringValue(source.difficulty),
    highlights: stringList(source.highlights),
    caveats: stringList(source.caveats),
    seasonality: stringValue(source.seasonality),
    editorialNote: stringValue(source.editorial_note),
    reviewStatus,
  };
}

function curationFromRoute(curation: RouteCuration): CurationDraft {
  return {
    vibe: curation.vibe ?? "",
    idealUse: curation.idealUse ?? "",
    terrain: curation.terrain ?? [],
    difficulty: curation.difficulty ?? "",
    highlights: curation.highlights ?? [],
    caveats: curation.caveats ?? [],
    seasonality: curation.seasonality ?? "",
    editorialNote: curation.editorialNote ?? "",
    reviewStatus: curation.reviewStatus,
  };
}

async function fetchWithTimeout(url: string) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 900);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    : [];
}
