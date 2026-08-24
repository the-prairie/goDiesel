import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { expect, test } from "vitest";

import { buildRouteRegions } from "@/data/route-regions";
import {
  completedRoutes,
  findRouteBySlug,
  routes,
} from "@/data/routes";
import {
  curatedDiscoveryCandidates,
  curatedRouteDiscoveryProvider,
} from "@/data/discovery-provider";
import type { FinderIntent } from "@/domain/planning";
import {
  parseRouteDetail,
  parseRouteSummary,
  type QuestRoute,
  type RoutePoint,
} from "@/domain/route";
import { routePathPose } from "@/domain/geometry/route-path";
import { filterRoutes, type RouteFilters } from "@/surfaces/routes/route-filters";
import {
  createRouteSceneManifest,
  resolveRouteSceneFrame,
} from "@/surfaces/replay/scene/route-scene-contract";
import {
  createSourceBackedCandidateCorpus,
  createSourceBackedRouteCorpus,
  findRouteBySlugInCorpus,
  searchDiscoveryCandidates,
} from "./runtime-corpus";

interface Distribution {
  samplesMs: number[];
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  meanMs: number;
  operationsPerSample: number;
  p50UsPerOperation: number;
  p95UsPerOperation: number;
  p99UsPerOperation: number;
}

interface BenchmarkResult extends Distribution {
  name: string;
  resultDigest: unknown;
  memoryBefore: NodeJS.MemoryUsage;
  memoryAfter: NodeJS.MemoryUsage;
}

const APP_ROOT = process.cwd();
const OUTPUT_DIR = path.resolve(APP_ROOT, "artifacts/runtime-performance");
const MANIFEST_PATH = path.resolve(
  APP_ROOT,
  "src/data/generated/routes.manifest.json",
);
const DETAIL_DIR = path.resolve(APP_ROOT, "public/data/routes");

function percentile(values: readonly number[], quantile: number) {
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.max(0, Math.ceil(quantile * sorted.length) - 1);
  return sorted[rank] ?? 0;
}

function summarize(samplesMs: number[], operationsPerSample: number): Distribution {
  const p50Ms = percentile(samplesMs, 0.5);
  const p95Ms = percentile(samplesMs, 0.95);
  const p99Ms = percentile(samplesMs, 0.99);
  return {
    samplesMs,
    p50Ms,
    p95Ms,
    p99Ms,
    meanMs: samplesMs.reduce((sum, value) => sum + value, 0) / samplesMs.length,
    operationsPerSample,
    p50UsPerOperation: (p50Ms * 1_000) / operationsPerSample,
    p95UsPerOperation: (p95Ms * 1_000) / operationsPerSample,
    p99UsPerOperation: (p99Ms * 1_000) / operationsPerSample,
  };
}

function benchmark<T>(options: {
  name: string;
  warmups?: number;
  samples?: number;
  operationsPerSample: number;
  run: () => T;
  digest: (result: T) => unknown;
}): BenchmarkResult {
  const {
    name,
    warmups = 3,
    samples = 15,
    operationsPerSample,
    run,
    digest,
  } = options;

  for (let index = 0; index < warmups; index += 1) run();
  const memoryBefore = process.memoryUsage();
  const samplesMs: number[] = [];
  let result!: T;
  for (let index = 0; index < samples; index += 1) {
    const started = performance.now();
    result = run();
    samplesMs.push(performance.now() - started);
  }
  const memoryAfter = process.memoryUsage();
  return {
    name,
    ...summarize(samplesMs, operationsPerSample),
    resultDigest: digest(result),
    memoryBefore,
    memoryAfter,
  };
}

function syntheticQuestRoute(pointCount: number): QuestRoute {
  const base = largestCurrentDetail();
  const points: RoutePoint[] = Array.from({ length: pointCount }, (_, index) => ({
    lat: 35 + index * 0.000_01,
    lng: 135 + Math.sin(index / 300) * 0.01,
    elev: 300 + Math.sin(index / 200) * 240,
    d: index * 4,
    elapsedS: index * 1.6,
  }));
  return {
    ...base,
    slug: `synthetic-long-${pointCount}`,
    activityId: `synthetic-long-${pointCount}`,
    name: `Synthetic ${pointCount}-point route`,
    activityName: `Synthetic ${pointCount}-point route`,
    distanceKm: (points.at(-1)?.d ?? 0) / 1_000,
    route: points,
    midIdx: Math.floor(points.length / 2),
    centerLat: 35 + pointCount * 0.000_005,
    centerLng: 135,
    provenance: {
      ...base.provenance,
      temporal: {
        status: "recorded",
        elapsedTimeS: points.at(-1)?.elapsedS,
      },
    },
  };
}

let cachedLargestDetail: QuestRoute | undefined;
function largestCurrentDetail() {
  if (cachedLargestDetail) return cachedLargestDetail;
  const detailPaths = fs
    .readdirSync(DETAIL_DIR)
    .filter((filename) => filename.endsWith(".json"))
    .map((filename) => path.join(DETAIL_DIR, filename));
  const largest = detailPaths
    .map((filename) => ({ filename, size: fs.statSync(filename).size }))
    .sort((left, right) => right.size - left.size)[0];
  if (!largest) throw new Error("No route detail fixtures found");
  cachedLargestDetail = parseRouteDetail(
    JSON.parse(fs.readFileSync(largest.filename, "utf8")),
  );
  return cachedLargestDetail;
}

function stableDigest(values: readonly string[]) {
  let hash = 2_166_136_261;
  for (const value of values) {
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16_777_619);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function environmentMetadata() {
  return {
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpuCount: os.cpus().length,
    cpuModel: os.cpus()[0]?.model,
    totalMemoryBytes: os.totalmem(),
    processArgs: process.argv,
  };
}

test("records the deterministic production-runtime baseline", () => {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const manifestText = fs.readFileSync(MANIFEST_PATH, "utf8");
  const manifestValue = JSON.parse(manifestText) as { routes?: unknown[] };
  const generatedRoutes = manifestValue.routes ?? [];
  const routeCorpus = createSourceBackedRouteCorpus(routes, 2_500);
  const candidateCorpus = createSourceBackedCandidateCorpus(
    curatedDiscoveryCandidates,
    10_000,
  );
  const synthetic50_000PointRoute = syntheticQuestRoute(50_000);
  const largestDetail = largestCurrentDetail();
  const sceneManifest = createRouteSceneManifest(largestDetail);

  const manifestBenchmark = benchmark({
    name: "manifest-json-and-summary-parse",
    operationsPerSample: generatedRoutes.length,
    samples: 20,
    run: () => {
      const parsed = JSON.parse(manifestText) as { routes?: unknown[] };
      return (parsed.routes ?? []).map(parseRouteSummary);
    },
    digest: (result) => ({
      count: result.length,
      orderDigest: stableDigest(result.map((route) => route.slug)),
    }),
  });

  const currentLookupQueries = Array.from({ length: 5_000 }, (_, index) =>
    index % 7 === 0
      ? `missing-${index}`
      : routes[index % routes.length].slug,
  );
  const currentRouteLookupBenchmark = benchmark({
    name: "route-lookup-current-library",
    operationsPerSample: currentLookupQueries.length,
    samples: 15,
    run: () =>
      currentLookupQueries.map(
        (slug) => findRouteBySlug(slug)?.slug ?? "missing",
      ),
    digest: (result) => ({ count: result.length, digest: stableDigest(result) }),
  });

  const sourceBackedLookupQueries = Array.from({ length: 5_000 }, (_, index) =>
    index % 7 === 0
      ? `missing-${index}`
      : routeCorpus.routes[index % routeCorpus.routes.length].slug,
  );
  const routeLookupBenchmark = benchmark({
    name: "route-lookup-2,500-source-backed-replicas",
    operationsPerSample: sourceBackedLookupQueries.length,
    samples: 15,
    run: () =>
      sourceBackedLookupQueries.map(
        (slug) =>
          findRouteBySlugInCorpus(routeCorpus.routes, slug)?.slug ?? "missing",
      ),
    digest: (result) => ({ count: result.length, digest: stableDigest(result) }),
  });

  const regionBenchmark = benchmark({
    name: "region-build-2,500-source-backed-replicas",
    operationsPerSample: routeCorpus.routes.length,
    samples: 20,
    run: () => buildRouteRegions(routeCorpus.routes),
    digest: (result) => ({
      count: result.length,
      orderDigest: stableDigest(
        result.map((region) => `${region.name}:${region.routes.length}`),
      ),
    }),
  });

  const filterMatrix: RouteFilters[] = [
    {
      query: routes[0]?.name.toLowerCase() ?? "route",
      lifecycle: "all",
      activity: "all",
      region: "all",
      distance: "all",
      climb: "all",
      vibe: "all",
    },
    {
      query: "",
      lifecycle: "completed",
      activity: "Run",
      region: routes.find((route) => route.type === "Run")?.region ?? "all",
      distance: "20-50",
      climb: "250-750",
      vibe: "all",
    },
    {
      query: routes.at(-1)?.region.toLowerCase() ?? "",
      lifecycle: "all",
      activity: "Ride",
      region: "all",
      distance: "10-20",
      climb: "all",
      vibe: "all",
    },
    {
      query: "",
      lifecycle: "discovered",
      activity: "all",
      region: "all",
      distance: "50-plus",
      climb: "750-plus",
      vibe: "all",
    },
  ];
  const routeFilterBenchmark = benchmark({
    name: "routes-filter-matrix-2,500-source-backed-replicas",
    operationsPerSample: routeCorpus.routes.length * filterMatrix.length,
    samples: 25,
    run: () =>
      filterMatrix.map((filters) => filterRoutes(routeCorpus.routes, filters)),
    digest: (result) => ({
      counts: result.map((routesForFilter) => routesForFilter.length),
      digests: result.map((routesForFilter) =>
        stableDigest(routesForFilter.map((route) => route.slug)),
      ),
    }),
  });

  const canonicalFinderCandidate = curatedDiscoveryCandidates[0];
  if (!canonicalFinderCandidate) {
    throw new Error("The production Finder corpus is empty");
  }
  const finderIntent: FinderIntent = {
    place: canonicalFinderCandidate.route.region,
    activity: canonicalFinderCandidate.route.type,
    distanceKm: canonicalFinderCandidate.route.distanceKm,
    terrain: "any",
    vibe: "",
  };
  expect(
    searchDiscoveryCandidates(curatedDiscoveryCandidates, finderIntent),
  ).toEqual(curatedRouteDiscoveryProvider.search(finderIntent));
  const finderBenchmark = benchmark({
    name: "finder-search-10,000-source-backed-replicas",
    operationsPerSample: candidateCorpus.candidates.length,
    samples: 25,
    run: () =>
      searchDiscoveryCandidates(candidateCorpus.candidates, finderIntent),
    digest: (result) => ({
      status: result.status,
      count: result.candidates.length,
      digest: stableDigest(result.candidates.map((candidate) => candidate.id)),
    }),
  });

  const poseQueries = Array.from({ length: 500 }, (_, index) =>
    ((index * 7_919) % 50_000) * 4 + 1.25,
  );
  const routePoseBenchmark = benchmark({
    name: "route-path-pose-50,000-points",
    operationsPerSample: poseQueries.length,
    samples: 10,
    run: () =>
      poseQueries.map((distance) => {
        const pose = routePathPose(synthetic50_000PointRoute, distance);
        return `${pose.progressM.toFixed(2)}:${pose.lat.toFixed(6)}:${pose.lng.toFixed(6)}:${pose.elev.toFixed(3)}:${pose.bearingDeg.toFixed(3)}`;
      }),
    digest: (result) => ({ count: result.length, digest: stableDigest(result) }),
  });

  const frameQueries = Array.from({ length: 120 }, (_, index) =>
    (sceneManifest.totalDistanceM * index) / 119,
  );
  const sceneFrameBenchmark = benchmark({
    name: "replay-scene-frame-current-largest-route",
    operationsPerSample: frameQueries.length,
    samples: 10,
    run: () =>
      frameQueries.map((progressM) =>
        resolveRouteSceneFrame(sceneManifest, {
          cameraMode: "auto",
          progressM,
          following: true,
          rangeScale: 1,
        }),
      ),
    digest: (result) => ({
      count: result.length,
      digest: stableDigest(
        result.map(
          (frame) =>
            `${frame.progressM.toFixed(3)}:${frame.subject.lat.toFixed(7)}:${frame.subject.lng.toFixed(7)}:${frame.camera.rangeM.toFixed(3)}:${frame.telemetry.elapsedS.toFixed(3)}`,
        ),
      ),
    }),
  });

  expect(routes.length).toBe(67);
  expect(completedRoutes.length).toBe(66);
  expect(generatedRoutes.length).toBe(67);
  expect(manifestBenchmark.resultDigest).toEqual({
    count: 67,
    orderDigest: stableDigest(routes.map((route) => route.slug)),
  });
  expect((finderBenchmark.resultDigest as { status: string }).status).toBe(
    "matches",
  );
  expect(new Set(routeCorpus.sourceSlugs).size).toBe(routes.length);

  const report = {
    schemaVersion: 2,
    environment: environmentMetadata(),
    corpus: {
      currentManifestBytes: Buffer.byteLength(manifestText),
      currentRouteCount: routes.length,
      currentCompletedRouteCount: completedRoutes.length,
      currentDetailCount: fs
        .readdirSync(DETAIL_DIR)
        .filter((file) => file.endsWith(".json")).length,
      sourceBackedReplicaCount: routeCorpus.routes.length,
      sourceBackedRouteCount: new Set(routeCorpus.sourceSlugs).size,
      sourceBackedTraceLengths: Array.from(
        new Set(routes.map((route) => route.trace.length)),
      ).sort((left, right) => left - right),
      sourceBackedFinderCandidateReplicaCount: candidateCorpus.candidates.length,
      sourceFinderCandidateCount: new Set(
        candidateCorpus.sourceCandidateIds,
      ).size,
      syntheticLongRoutePointCount: synthetic50_000PointRoute.route.length,
      largestCurrentDetailSlug: largestDetail.slug,
      largestCurrentDetailPointCount: largestDetail.route.length,
      methodology:
        "The 2,500-route corpus cycles through every real generated route and preserves each source route's geometry and attributes. Only route identity is replicated to exercise production cardinality.",
    },
    benchmarks: [
      manifestBenchmark,
      currentRouteLookupBenchmark,
      routeLookupBenchmark,
      regionBenchmark,
      routeFilterBenchmark,
      finderBenchmark,
      routePoseBenchmark,
      sceneFrameBenchmark,
    ],
  };
  fs.writeFileSync(
    path.join(OUTPUT_DIR, "runtime-baseline-node.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
});
