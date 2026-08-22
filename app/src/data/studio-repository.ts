import { parseRouteDetail, type QuestRoute } from "@/domain/route";

const studioApiBase =
  import.meta.env.VITE_ADMIN_API_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:8766";

export interface StudioCandidate {
  id: string;
  label: string;
  geometryKind: string;
  distanceM: number;
  ascentM: number | null;
  pointCount: number;
  segmentCount: number;
  elevationStatus: "recorded" | "unavailable";
  timingStatus: "recorded" | "unavailable";
  geometryFingerprint: string;
  previewSegments: Array<Array<[number, number, number | null]>>;
}

export interface StudioFinding {
  severity: "blocker" | "warning" | "information";
  code: string;
  message: string;
}

export interface StudioJob {
  id: string;
  status: string;
  selectedGeometryId: string | null;
  retryable: boolean;
  source: {
    id: string;
    sha256: string;
    originalFilename: string;
    sourceFormat: "gpx" | "kml" | "kmz";
  };
  inspection: {
    candidates: StudioCandidate[];
    findings: StudioFinding[];
    sourceFormat: "gpx" | "kml" | "kmz";
  };
  metadata: StudioMetadata | null;
  stagedRoute: QuestRoute | null;
  events: Array<{ id: number; level: string; code: string; message: string; createdAt: string }>;
  renderAttempts: Array<{
    id: string;
    status: string;
    progress: number;
    outputPath: string | null;
    renderFingerprint: string;
  }>;
  errors: Array<{ stage: string; code: string; message: string; retryable: boolean }>;
}

export interface StudioMetadata {
  name: string;
  activityType: "Run" | "Ride";
  completedByOwner: boolean;
  date: string;
  region: string;
  privacy: "private" | "public";
}

export async function uploadStudioSource(file: File) {
  const response = await fetch(`${studioApiBase}/api/studio/sources`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream", "X-Source-Filename": file.name },
    body: file,
  });
  return responseBody(response) as Promise<{ job_id: string; exact_duplicate: boolean }>;
}

export async function loadStudioJobs() {
  const response = await fetch(`${studioApiBase}/api/studio/jobs`);
  const value = await responseBody(response);
  if (!Array.isArray(value)) throw new Error("Studio job list is invalid.");
  return value.map(parseStudioJob);
}

export async function loadStudioJob(jobId: string) {
  const response = await fetch(`${studioApiBase}/api/studio/jobs/${encodeURIComponent(jobId)}`);
  return parseStudioJob(await responseBody(response));
}

export async function selectStudioGeometry(jobId: string, candidateId: string) {
  return mutateJob(jobId, "select-geometry", { candidate_id: candidateId });
}

export async function saveStudioMetadata(jobId: string, metadata: StudioMetadata) {
  return mutateJob(jobId, "metadata", {
    name: metadata.name,
    activity_type: metadata.activityType,
    completed_by_owner: metadata.completedByOwner,
    date: metadata.date,
    region: metadata.region,
    privacy: metadata.privacy,
  });
}

export async function compileStudioRoute(jobId: string) {
  const response = await fetch(
    `${studioApiBase}/api/studio/jobs/${encodeURIComponent(jobId)}/compile`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    },
  );
  await responseBody(response);
  return loadStudioJob(jobId);
}

export async function renderStudioRoute(jobId: string) {
  return mutateJob(jobId, "render", { base_url: window.location.origin });
}

export async function cancelStudioJob(jobId: string) {
  return mutateJob(jobId, "cancel", {});
}

export async function retryStudioJob(jobId: string) {
  return mutateJob(jobId, "retry", { base_url: window.location.origin });
}

export async function promoteStudioRoute(jobId: string) {
  return mutateJob(jobId, "promote", {});
}

async function mutateJob(jobId: string, action: string, body: unknown) {
  const response = await fetch(
    `${studioApiBase}/api/studio/jobs/${encodeURIComponent(jobId)}/${action}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  return parseStudioJob(await responseBody(response));
}

export function parseStagedRoute(value: unknown, expectedSlug?: string) {
  const route = parseRouteDetail(value);
  if (expectedSlug && route.slug !== expectedSlug) {
    throw new Error("Staged route did not match the selected Studio job.");
  }
  return route;
}

function parseStudioJob(value: unknown): StudioJob {
  const source = record(value, "Studio job");
  const sourceRecord = record(source.source, "Studio source");
  const inspection = record(source.inspection, "Studio inspection");
  const candidates = Array.isArray(inspection.candidates) ? inspection.candidates : [];
  const findings = Array.isArray(inspection.findings) ? inspection.findings : [];
  const metadata = source.metadata ? parseMetadata(source.metadata) : null;
  const stagedRaw = source.staged_route;
  return {
    id: text(source.id),
    status: text(source.status),
    selectedGeometryId: nullableText(source.selected_geometry_id),
    retryable: source.retryable === true,
    source: {
      id: text(sourceRecord.id),
      sha256: text(sourceRecord.sha256),
      originalFilename: text(sourceRecord.original_filename),
      sourceFormat: sourceFormat(sourceRecord.source_format),
    },
    inspection: {
      candidates: candidates.map(parseCandidate),
      findings: findings.map(parseFinding),
      sourceFormat: sourceFormat(inspection.source_format),
    },
    metadata,
    stagedRoute: stagedRaw ? parseStagedRoute(stagedRaw) : null,
    events: (Array.isArray(source.events) ? source.events : []).map((item) => {
      const event = record(item, "Studio event");
      return {
        id: number(event.id), level: text(event.level), code: text(event.code),
        message: text(event.message), createdAt: text(event.created_at),
      };
    }),
    renderAttempts: (Array.isArray(source.render_attempts) ? source.render_attempts : []).map((item) => {
      const attempt = record(item, "Studio render attempt");
      return {
        id: text(attempt.id), status: text(attempt.status), progress: number(attempt.progress),
        outputPath: nullableText(attempt.output_path), renderFingerprint: text(attempt.render_fingerprint),
      };
    }),
    errors: (Array.isArray(source.errors) ? source.errors : []).map((item) => {
      const error = record(item, "Studio error");
      return { stage: text(error.stage), code: text(error.code), message: text(error.message), retryable: error.retryable === true };
    }),
  };
}

function parseCandidate(value: unknown): StudioCandidate {
  const source = record(value, "Studio geometry candidate");
  return {
    id: text(source.id), label: text(source.label), geometryKind: text(source.geometry_kind),
    distanceM: number(source.distance_m), ascentM: nullableNumber(source.ascent_m),
    pointCount: number(source.point_count), segmentCount: number(source.segment_count),
    elevationStatus: availability(source.elevation_status),
    timingStatus: availability(source.timing_status),
    geometryFingerprint: text(source.geometry_fingerprint),
    previewSegments: parsePreviewSegments(source.preview_segments),
  };
}

function parseFinding(value: unknown): StudioFinding {
  const source = record(value, "Studio finding");
  const severity = source.severity;
  if (severity !== "blocker" && severity !== "warning" && severity !== "information") {
    throw new Error("Studio finding severity is invalid.");
  }
  return { severity, code: text(source.code), message: text(source.message) };
}

function parseMetadata(value: unknown): StudioMetadata {
  const source = record(value, "Studio metadata");
  return {
    name: text(source.name),
    activityType: source.activity_type === "Ride" ? "Ride" : "Run",
    completedByOwner: source.completed_by_owner === true,
    date: text(source.date), region: text(source.region),
    privacy: source.privacy === "public" ? "public" : "private",
  };
}

async function responseBody(response: Response) {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(text(body.error) || `Studio request failed with status ${response.status}.`);
  return body;
}

function record(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid.`);
  return value as Record<string, unknown>;
}

function text(value: unknown) { return typeof value === "string" ? value : ""; }
function nullableText(value: unknown) { return typeof value === "string" ? value : null; }
function number(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? value : 0; }
function nullableNumber(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function availability(value: unknown) { return value === "recorded" ? "recorded" : "unavailable"; }
function sourceFormat(value: unknown) { return value === "kml" || value === "kmz" ? value : "gpx"; }
function parsePreviewSegments(value: unknown): Array<Array<[number, number, number | null]>> {
  if (!Array.isArray(value)) return [];
  return value.map((segment) =>
    (Array.isArray(segment) ? segment : []).flatMap((point) => {
      if (!Array.isArray(point) || typeof point[0] !== "number" || typeof point[1] !== "number") return [];
      return [[point[0], point[1], typeof point[2] === "number" ? point[2] : null] as [number, number, number | null]];
    }),
  );
}
