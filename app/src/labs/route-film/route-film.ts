export const routeFilmCuts = [
  "feature",
  "monumental",
  "kinetic",
  "intimate",
] as const;

export type RouteFilmCut = (typeof routeFilmCuts)[number];
export type RouteFilmStatus = "queued" | "rendering" | "failed" | "ready";

export interface RouteFilmProvider {
  name: string;
  renderId?: string;
}

export interface RouteFilmChecksum {
  algorithm: "sha256";
  value: string;
}

export interface RouteFilmFile {
  uri: string;
  mediaType: string;
  bytes?: number;
  checksum?: RouteFilmChecksum;
}

export interface RouteFilmPoster extends RouteFilmFile {
  widthPx: number;
  heightPx: number;
}

export interface RouteFilmVideo extends RouteFilmPoster {
  durationSeconds: number;
  codec?: string;
  frameRate?: number;
}

export interface RouteFilmEvidence extends RouteFilmFile {
  generatedAt: string;
  frameCount?: number;
  verifiedFrameCount?: number;
}

interface RouteFilmIdentity {
  routeId: string;
  cut: RouteFilmCut;
  version: number;
  provider: RouteFilmProvider;
  requestedAt: string;
}

export interface QueuedRouteFilm extends RouteFilmIdentity {
  status: "queued";
}

export interface RenderingRouteFilm extends RouteFilmIdentity {
  status: "rendering";
  startedAt: string;
  progress?: number;
  evidence?: RouteFilmEvidence;
}

export interface FailedRouteFilm extends RouteFilmIdentity {
  status: "failed";
  startedAt?: string;
  failedAt: string;
  failure: {
    code: string;
    message: string;
    retryable: boolean;
  };
  evidence?: RouteFilmEvidence;
}

export interface ReadyRouteFilm extends RouteFilmIdentity {
  status: "ready";
  startedAt: string;
  readyAt: string;
  poster: RouteFilmPoster;
  master: RouteFilmVideo;
  proxy: RouteFilmVideo;
  evidence: RouteFilmEvidence;
}

export type RouteFilm =
  | QueuedRouteFilm
  | RenderingRouteFilm
  | FailedRouteFilm
  | ReadyRouteFilm;

export interface RouteFilmValidationIssue {
  path: string;
  message: string;
}

export type RouteFilmValidationResult =
  | { success: true; value: RouteFilm }
  | { success: false; issues: RouteFilmValidationIssue[] };

export class RouteFilmValidationError extends Error {
  readonly issues: RouteFilmValidationIssue[];

  constructor(issues: RouteFilmValidationIssue[]) {
    super(issues.map(({ path, message }) => `${path}: ${message}`).join("; "));
    this.name = "RouteFilmValidationError";
    this.issues = issues;
  }
}

const rootFields = new Set([
  "routeId",
  "cut",
  "version",
  "provider",
  "requestedAt",
  "status",
  "startedAt",
  "progress",
  "failedAt",
  "failure",
  "readyAt",
  "poster",
  "master",
  "proxy",
  "evidence",
]);
const routeFilmDurationToleranceSeconds = 0.1;

export function validateRouteFilm(value: unknown): RouteFilmValidationResult {
  const issues: RouteFilmValidationIssue[] = [];
  const source = objectValue(value, "$", issues);
  if (!source) return { success: false, issues };

  unknownFields(source, rootFields, "$", issues);
  const status = enumValue(
    source.status,
    ["queued", "rendering", "failed", "ready"] as const,
    "status",
    issues,
  );
  const identity = {
    routeId: stringValue(source.routeId, "routeId", issues),
    cut: enumValue(source.cut, routeFilmCuts, "cut", issues),
    version: positiveInteger(source.version, "version", issues),
    provider: providerValue(source.provider, "provider", issues),
    requestedAt: timestampValue(source.requestedAt, "requestedAt", issues),
  };

  let film: RouteFilm | undefined;
  if (status === "queued") {
    disallow(
      source,
      [
        "startedAt",
        "progress",
        "failedAt",
        "failure",
        "readyAt",
        "poster",
        "master",
        "proxy",
        "evidence",
      ],
      issues,
    );
    film = { ...identity, status } as QueuedRouteFilm;
  } else if (status === "rendering") {
    disallow(
      source,
      ["failedAt", "failure", "readyAt", "poster", "master", "proxy"],
      issues,
    );
    const startedAt = timestampValue(source.startedAt, "startedAt", issues);
    timestampNotBefore(identity.requestedAt, startedAt, "requestedAt", "startedAt", issues);
    film = {
      ...identity,
      status,
      startedAt,
      progress: optionalProgress(source.progress, "progress", issues),
      evidence: optionalEvidence(source.evidence, "evidence", issues),
    } as RenderingRouteFilm;
  } else if (status === "failed") {
    disallow(source, ["progress", "readyAt", "poster", "master", "proxy"], issues);
    const startedAt =
      source.startedAt === undefined
        ? undefined
        : timestampValue(source.startedAt, "startedAt", issues);
    const failedAt = timestampValue(source.failedAt, "failedAt", issues);
    timestampNotBefore(identity.requestedAt, failedAt, "requestedAt", "failedAt", issues);
    if (startedAt !== undefined) {
      timestampNotBefore(identity.requestedAt, startedAt, "requestedAt", "startedAt", issues);
      timestampNotBefore(startedAt, failedAt, "startedAt", "failedAt", issues);
    }
    film = {
      ...identity,
      status,
      startedAt,
      failedAt,
      failure: failureValue(source.failure, "failure", issues),
      evidence: optionalEvidence(source.evidence, "evidence", issues),
    } as FailedRouteFilm;
  } else if (status === "ready") {
    disallow(source, ["progress", "failedAt", "failure"], issues);
    const startedAt = timestampValue(source.startedAt, "startedAt", issues);
    const readyAt = timestampValue(source.readyAt, "readyAt", issues);
    const poster = posterValue(source.poster, "poster", issues);
    const master = videoValue(source.master, "master", issues);
    const proxy = videoValue(source.proxy, "proxy", issues);
    timestampNotBefore(identity.requestedAt, startedAt, "requestedAt", "startedAt", issues);
    timestampNotBefore(startedAt, readyAt, "startedAt", "readyAt", issues);
    durationsWithinTolerance(master, proxy, "proxy.durationSeconds", issues);
    film = {
      ...identity,
      status,
      startedAt,
      readyAt,
      poster,
      master,
      proxy,
      evidence: evidenceValue(source.evidence, "evidence", issues),
    } as ReadyRouteFilm;
  }

  if (issues.length > 0 || !film) return { success: false, issues };
  return { success: true, value: removeUndefined(film) };
}

export function parseRouteFilm(value: unknown): RouteFilm {
  const result = validateRouteFilm(value);
  if (!result.success) throw new RouteFilmValidationError(result.issues);
  return result.value;
}

export function isRouteFilm(value: unknown): value is RouteFilm {
  return validateRouteFilm(value).success;
}

export function isReadyRouteFilm(film: RouteFilm): film is ReadyRouteFilm {
  return film.status === "ready";
}

function providerValue(
  value: unknown,
  path: string,
  issues: RouteFilmValidationIssue[],
): RouteFilmProvider {
  const source = objectValue(value, path, issues);
  if (!source) return { name: "" };
  unknownFields(source, new Set(["name", "renderId"]), path, issues);
  return removeUndefined({
    name: stringValue(source.name, `${path}.name`, issues),
    renderId: optionalString(source.renderId, `${path}.renderId`, issues),
  });
}

function posterValue(
  value: unknown,
  path: string,
  issues: RouteFilmValidationIssue[],
): RouteFilmPoster {
  const source = objectValue(value, path, issues);
  if (!source) return { uri: "", mediaType: "", widthPx: 0, heightPx: 0 };
  unknownFields(
    source,
    new Set(["uri", "mediaType", "bytes", "checksum", "widthPx", "heightPx"]),
    path,
    issues,
  );
  const file = fileValue(source, path, issues);
  mediaTypeWithPrefix(file.mediaType, "image/", `${path}.mediaType`, issues);
  return {
    ...file,
    widthPx: positiveInteger(source.widthPx, `${path}.widthPx`, issues),
    heightPx: positiveInteger(source.heightPx, `${path}.heightPx`, issues),
  };
}

function videoValue(
  value: unknown,
  path: string,
  issues: RouteFilmValidationIssue[],
): RouteFilmVideo {
  const source = objectValue(value, path, issues);
  if (!source) {
    return { uri: "", mediaType: "", widthPx: 0, heightPx: 0, durationSeconds: 0 };
  }
  unknownFields(
    source,
    new Set([
      "uri",
      "mediaType",
      "bytes",
      "checksum",
      "widthPx",
      "heightPx",
      "durationSeconds",
      "codec",
      "frameRate",
    ]),
    path,
    issues,
  );
  const file = fileValue(source, path, issues);
  mediaTypeWithPrefix(file.mediaType, "video/", `${path}.mediaType`, issues);
  return removeUndefined({
    ...file,
    widthPx: positiveInteger(source.widthPx, `${path}.widthPx`, issues),
    heightPx: positiveInteger(source.heightPx, `${path}.heightPx`, issues),
    durationSeconds: positiveNumber(
      source.durationSeconds,
      `${path}.durationSeconds`,
      issues,
    ),
    codec: optionalString(source.codec, `${path}.codec`, issues),
    frameRate: optionalPositiveNumber(source.frameRate, `${path}.frameRate`, issues),
  });
}

function evidenceValue(
  value: unknown,
  path: string,
  issues: RouteFilmValidationIssue[],
): RouteFilmEvidence {
  const source = objectValue(value, path, issues);
  if (!source) return { uri: "", mediaType: "", generatedAt: "" };
  unknownFields(
    source,
    new Set([
      "uri",
      "mediaType",
      "bytes",
      "checksum",
      "generatedAt",
      "frameCount",
      "verifiedFrameCount",
    ]),
    path,
    issues,
  );
  const frameCount = optionalPositiveInteger(source.frameCount, `${path}.frameCount`, issues);
  const verifiedFrameCount = optionalNonNegativeInteger(
    source.verifiedFrameCount,
    `${path}.verifiedFrameCount`,
    issues,
  );
  if (
    frameCount !== undefined &&
    verifiedFrameCount !== undefined &&
    verifiedFrameCount > frameCount
  ) {
    issue(issues, `${path}.verifiedFrameCount`, "must not exceed frameCount");
  }
  return removeUndefined({
    ...fileValue(source, path, issues),
    generatedAt: timestampValue(source.generatedAt, `${path}.generatedAt`, issues),
    frameCount,
    verifiedFrameCount,
  });
}

function optionalEvidence(
  value: unknown,
  path: string,
  issues: RouteFilmValidationIssue[],
) {
  return value === undefined ? undefined : evidenceValue(value, path, issues);
}

function fileValue(
  source: Record<string, unknown>,
  path: string,
  issues: RouteFilmValidationIssue[],
): RouteFilmFile {
  return removeUndefined({
    uri: stringValue(source.uri, `${path}.uri`, issues),
    mediaType: stringValue(source.mediaType, `${path}.mediaType`, issues),
    bytes: optionalPositiveInteger(source.bytes, `${path}.bytes`, issues),
    checksum: optionalChecksum(source.checksum, `${path}.checksum`, issues),
  });
}

function optionalChecksum(
  value: unknown,
  path: string,
  issues: RouteFilmValidationIssue[],
): RouteFilmChecksum | undefined {
  if (value === undefined) return undefined;
  const source = objectValue(value, path, issues);
  if (!source) return undefined;
  unknownFields(source, new Set(["algorithm", "value"]), path, issues);
  const algorithm = enumValue(source.algorithm, ["sha256"] as const, `${path}.algorithm`, issues);
  const checksum = stringValue(source.value, `${path}.value`, issues).toLowerCase();
  if (checksum && !/^[a-f0-9]{64}$/.test(checksum)) {
    issue(issues, `${path}.value`, "must be a 64-character hexadecimal SHA-256 digest");
  }
  return { algorithm: algorithm ?? "sha256", value: checksum };
}

function failureValue(
  value: unknown,
  path: string,
  issues: RouteFilmValidationIssue[],
): FailedRouteFilm["failure"] {
  const source = objectValue(value, path, issues);
  if (!source) return { code: "", message: "", retryable: false };
  unknownFields(source, new Set(["code", "message", "retryable"]), path, issues);
  const retryable = source.retryable;
  if (typeof retryable !== "boolean") issue(issues, `${path}.retryable`, "must be a boolean");
  return {
    code: stringValue(source.code, `${path}.code`, issues),
    message: stringValue(source.message, `${path}.message`, issues),
    retryable: typeof retryable === "boolean" ? retryable : false,
  };
}

function objectValue(
  value: unknown,
  path: string,
  issues: RouteFilmValidationIssue[],
): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    issue(issues, path, "must be an object");
    return undefined;
  }
  return value as Record<string, unknown>;
}

function stringValue(
  value: unknown,
  path: string,
  issues: RouteFilmValidationIssue[],
): string {
  if (typeof value !== "string" || !value.trim()) {
    issue(issues, path, "must be a non-empty string");
    return "";
  }
  return value.trim();
}

function optionalString(
  value: unknown,
  path: string,
  issues: RouteFilmValidationIssue[],
) {
  return value === undefined ? undefined : stringValue(value, path, issues);
}

function timestampValue(
  value: unknown,
  path: string,
  issues: RouteFilmValidationIssue[],
): string {
  const timestamp = stringValue(value, path, issues);
  if (timestamp && !Number.isFinite(Date.parse(timestamp))) {
    issue(issues, path, "must be a valid timestamp");
  }
  return timestamp;
}

function timestampNotBefore(
  earlier: string,
  later: string,
  earlierPath: string,
  laterPath: string,
  issues: RouteFilmValidationIssue[],
) {
  const earlierTime = Date.parse(earlier);
  const laterTime = Date.parse(later);
  if (
    Number.isFinite(earlierTime) &&
    Number.isFinite(laterTime) &&
    laterTime < earlierTime
  ) {
    issue(issues, laterPath, `must not precede ${earlierPath}`);
  }
}

function mediaTypeWithPrefix(
  mediaType: string,
  prefix: string,
  path: string,
  issues: RouteFilmValidationIssue[],
) {
  if (mediaType && !mediaType.toLowerCase().startsWith(prefix)) {
    issue(issues, path, `must be a ${prefix.slice(0, -1)} media type`);
  }
}

function durationsWithinTolerance(
  master: RouteFilmVideo,
  proxy: RouteFilmVideo,
  path: string,
  issues: RouteFilmValidationIssue[],
) {
  if (
    Math.abs(master.durationSeconds - proxy.durationSeconds) >
    routeFilmDurationToleranceSeconds
  ) {
    issue(
      issues,
      path,
      `must be within ${routeFilmDurationToleranceSeconds} seconds of master.durationSeconds`,
    );
  }
}

function positiveNumber(
  value: unknown,
  path: string,
  issues: RouteFilmValidationIssue[],
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    issue(issues, path, "must be a positive finite number");
    return 0;
  }
  return value;
}

function optionalPositiveNumber(
  value: unknown,
  path: string,
  issues: RouteFilmValidationIssue[],
) {
  return value === undefined ? undefined : positiveNumber(value, path, issues);
}

function positiveInteger(
  value: unknown,
  path: string,
  issues: RouteFilmValidationIssue[],
): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    issue(issues, path, "must be a positive integer");
    return 0;
  }
  return value as number;
}

function optionalPositiveInteger(
  value: unknown,
  path: string,
  issues: RouteFilmValidationIssue[],
) {
  return value === undefined ? undefined : positiveInteger(value, path, issues);
}

function optionalNonNegativeInteger(
  value: unknown,
  path: string,
  issues: RouteFilmValidationIssue[],
) {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < 0) {
    issue(issues, path, "must be a non-negative integer");
    return 0;
  }
  return value as number;
}

function optionalProgress(
  value: unknown,
  path: string,
  issues: RouteFilmValidationIssue[],
) {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    issue(issues, path, "must be a finite number from 0 to 1");
    return 0;
  }
  return value;
}

function enumValue<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  path: string,
  issues: RouteFilmValidationIssue[],
): Values[number] | undefined {
  if (typeof value !== "string" || !values.includes(value)) {
    issue(issues, path, `must be one of: ${values.join(", ")}`);
    return undefined;
  }
  return value;
}

function unknownFields(
  source: Record<string, unknown>,
  fields: Set<string>,
  path: string,
  issues: RouteFilmValidationIssue[],
) {
  for (const field of Object.keys(source)) {
    if (!fields.has(field)) {
      issue(
        issues,
        path === "$" ? field : `${path}.${field}`,
        "is not supported",
      );
    }
  }
}

function disallow(
  source: Record<string, unknown>,
  fields: string[],
  issues: RouteFilmValidationIssue[],
) {
  for (const field of fields) {
    if (source[field] !== undefined) {
      issue(
        issues,
        field,
        `is not valid when status is ${source.status}`,
      );
    }
  }
}

function issue(
  issues: RouteFilmValidationIssue[],
  path: string,
  message: string,
) {
  issues.push({ path, message });
}

function removeUndefined<Value extends object>(value: Value): Value {
  return Object.fromEntries(
    Object.entries(value).filter(([, field]) => field !== undefined),
  ) as Value;
}
