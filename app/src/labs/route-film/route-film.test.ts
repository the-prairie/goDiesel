import { describe, expect, it } from "vitest";

import {
  isReadyRouteFilm,
  isRouteFilm,
  parseRouteFilm,
  RouteFilmValidationError,
  validateRouteFilm,
} from "@/labs/route-film/route-film";

const identity = {
  routeId: "14736711660",
  cut: "feature",
  version: 1,
  provider: { name: "local-deterministic-renderer", renderId: "render-42" },
  requestedAt: "2026-07-25T18:00:00Z",
} as const;

const file = {
  uri: "route-films/san-francisco-feature.mov",
  mediaType: "video/quicktime",
  bytes: 42_000,
  checksum: { algorithm: "sha256", value: "a".repeat(64) },
} as const;

type ReadyFilm = ReturnType<typeof readyFilm>;
type ReadyFilmChanges = Partial<Pick<ReadyFilm, "startedAt" | "readyAt">> & {
  poster?: Partial<ReadyFilm["poster"]>;
  master?: Partial<ReadyFilm["master"]>;
  proxy?: Partial<ReadyFilm["proxy"]>;
};

describe("parseRouteFilm", () => {
  it.each([
    { ...identity, status: "queued" },
    {
      ...identity,
      status: "rendering",
      startedAt: "2026-07-25T18:01:00Z",
      progress: 0.5,
    },
    {
      ...identity,
      status: "failed",
      startedAt: "2026-07-25T18:01:00Z",
      failedAt: "2026-07-25T18:02:00Z",
      failure: {
        code: "provider-unavailable",
        message: "Photorealistic provider did not become ready.",
        retryable: true,
      },
    },
  ])("parses the $status lifecycle state", (candidate) => {
    expect(parseRouteFilm(candidate)).toEqual(candidate);
    expect(isRouteFilm(candidate)).toBe(true);
  });

  it("requires a ready film to carry its complete delivery and evidence set", () => {
    const candidate = readyFilm();

    const film = parseRouteFilm(candidate);

    expect(film).toEqual(candidate);
    expect(isReadyRouteFilm(film)).toBe(true);
    if (!isReadyRouteFilm(film)) throw new Error("expected a ready route film");
    expect(film.master.codec).toBe("prores");
  });

  it.each([
    ["starts before it was requested", { startedAt: "2026-07-25T17:59:59Z" }, "startedAt"],
    ["becomes ready before it started", { readyAt: "2026-07-25T18:00:59Z" }, "readyAt"],
    ["uses a non-image poster", { poster: { mediaType: "video/mp4" } }, "poster.mediaType"],
    ["uses a non-video master", { master: { mediaType: "image/jpeg" } }, "master.mediaType"],
    ["uses a non-video proxy", { proxy: { mediaType: "application/octet-stream" } }, "proxy.mediaType"],
    ["has mismatched delivery durations", { proxy: { durationSeconds: 40.8 } }, "proxy.durationSeconds"],
  ])("rejects a ready film that %s", (_description, changes, path) => {
    const candidate = readyFilm();
    const overrides = changes as ReadyFilmChanges;
    const result = validateRouteFilm({
      ...candidate,
      ...overrides,
      poster: { ...candidate.poster, ...overrides.poster },
      master: { ...candidate.master, ...overrides.master },
      proxy: { ...candidate.proxy, ...overrides.proxy },
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected validation to fail");
    expect(result.issues.map((issue) => issue.path)).toContain(path);
  });

  it.each([
    [
      "rendering",
      { ...identity, status: "rendering", startedAt: "2026-07-25T17:59:59Z" },
      "startedAt",
    ],
    [
      "failed before it was requested",
      {
        ...identity,
        status: "failed",
        failedAt: "2026-07-25T17:59:59Z",
        failure: { code: "cancelled", message: "Cancelled before rendering.", retryable: false },
      },
      "failedAt",
    ],
    [
      "failed before rendering started",
      {
        ...identity,
        status: "failed",
        startedAt: "2026-07-25T18:01:00Z",
        failedAt: "2026-07-25T18:00:30Z",
        failure: { code: "cancelled", message: "Cancelled while rendering.", retryable: false },
      },
      "failedAt",
    ],
  ])("rejects a %s lifecycle timestamp regression", (_description, candidate, path) => {
    const result = validateRouteFilm(candidate);

    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected validation to fail");
    expect(result.issues.map((issue) => issue.path)).toContain(path);
  });

  it("rejects state metadata that contradicts the lifecycle", () => {
    const result = validateRouteFilm({
      ...identity,
      status: "queued",
      readyAt: "2026-07-25T18:30:00Z",
    });

    expect(result).toEqual({
      success: false,
      issues: [
        {
          path: "readyAt",
          message: "is not valid when status is queued",
        },
      ],
    });
  });

  it("reports focused paths for malformed delivery metadata", () => {
    const candidate = {
      ...identity,
      status: "ready",
      startedAt: "2026-07-25T18:01:00Z",
      readyAt: "not-a-date",
      poster: {
        uri: "",
        mediaType: "image/jpeg",
        widthPx: 0,
        heightPx: 1080,
      },
      master: {
        ...file,
        widthPx: 3840,
        heightPx: 2160,
        durationSeconds: 40.6,
      },
      proxy: {
        ...file,
        widthPx: 1920,
        heightPx: 1080,
        durationSeconds: 40.6,
      },
      evidence: {
        uri: "route-films/report.json",
        mediaType: "application/json",
        generatedAt: "2026-07-25T18:30:00Z",
        frameCount: 100,
        verifiedFrameCount: 101,
      },
    };

    expect(() => parseRouteFilm(candidate)).toThrow(RouteFilmValidationError);
    const result = validateRouteFilm(candidate);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected validation to fail");
    expect(result.issues.map(({ path }) => path)).toEqual([
      "readyAt",
      "poster.uri",
      "poster.widthPx",
      "evidence.verifiedFrameCount",
    ]);
    expect(isRouteFilm(candidate)).toBe(false);
  });

  it("rejects invalid cuts, versions, progress, and unknown fields", () => {
    const result = validateRouteFilm({
      ...identity,
      cut: "director-secret",
      version: 0,
      status: "rendering",
      startedAt: "2026-07-25T18:01:00Z",
      progress: 1.2,
      storageBucket: "route-films",
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected validation to fail");
    expect(result.issues.map(({ path }) => path)).toEqual([
      "storageBucket",
      "cut",
      "version",
      "progress",
    ]);
  });
});

function readyFilm() {
  return {
    ...identity,
    status: "ready" as const,
    startedAt: "2026-07-25T18:01:00Z",
    readyAt: "2026-07-25T18:30:00Z",
    poster: {
      uri: "route-films/san-francisco-feature.jpg",
      mediaType: "image/jpeg",
      widthPx: 1920,
      heightPx: 1080,
    },
    master: {
      ...file,
      widthPx: 3840,
      heightPx: 2160,
      durationSeconds: 40.65,
      codec: "prores",
      frameRate: 24,
    },
    proxy: {
      ...file,
      uri: "route-films/san-francisco-feature.mp4",
      mediaType: "video/mp4",
      widthPx: 1920,
      heightPx: 1080,
      durationSeconds: 40.6,
      codec: "h264",
      frameRate: 24,
    },
    evidence: {
      uri: "route-films/san-francisco-feature.report.json",
      mediaType: "application/json",
      generatedAt: "2026-07-25T18:30:00Z",
      frameCount: 975,
      verifiedFrameCount: 975,
    },
  };
}
