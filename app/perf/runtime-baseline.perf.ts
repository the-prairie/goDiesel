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
import type {
  DiscoveryCandidate,
  FinderIntent,
} from "@/domain/planning";
import {
  parseRouteDetail,
  parseRouteSummary,
  type QuestRoute,
  type RoutePoint,
  type RouteSummary,
} from "@/domain/route";
import { routePathPose } from "@/domain/geometry/route-path";
import { filterRoutes, type RouteFilters } from "@/surfaces/routes/route-filters";
import {
  createRouteSceneManifest,
  resolveRouteSceneFrame,
} from "@/surfaces/replay/scene/route-scene-contract";

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

function cloneSummary(
  base: RouteSummary,
  index: number,
  overrides: Partial<RouteSummary> = {},
): RouteSummary {
  const regionIndex = index % 125;
  const lifecycle = index % 11 === 0 ? "discovered" : "completed";
  return {
    ...base,
    slug: `synthetic-${index.toString().padStart(5, "0")}`,
    activityId: `synthetic-activity-${index}`,
    lifecycle,
    name: `Synthetic route ${index}`,
    subtitle: `Synthetic comparison route ${index}`,
    activityName: `Synthetic activity ${index}`,
    region: `Region ${regionIndex.toString().padStart(3, "0")}`,
    distanceKm: 4 + (index % 80) * 0.9,
    elevationGainM: (index * 37) % 1_600,
    type: index % 7 === 0 ? "Ride" : "Run",
    description: `Synthetic route ${index} through region ${regionIndex}`,
    difficulty: ["Easy", "Moderate", "Hard"][index % 3],
    theme: ["Exploratory", "Coastal", "Mountain", "Urban"][index % 4],
    xp: index % 100,
    centerLat: -55 + (index % 110),
    centerLng: -170 + ((index * 13) % 340),
    trace: base.trace,
    guide: {
      ...base.guide,
      vibe: ["exploratory", "coastal", "mountain", "urban"][index % 4],
    },
    ...overrides,
  };
}

function syntheticSummaries(count: number) {
  const base = routes[0];
  if (!base) throw new Error("Runtime benchmark requires at least one route");
  return Array.from({ length: count }, (_, index) => cloneSummary(base, index));
}

function syntheticCandidates(count: number): DiscoveryCandidate[] {
  const base = curatedDiscoveryCandidates[0];
  if (!base) throw new Error("Runtime benchmark requires one Finder candidate");
  return Array.from({ length: count }, (_, index) => {
    const route = cloneSummary(base.route, index, {
      region: index % 20 === 0 ? "Kyoto, Japan" : `Region ${index % 125}`,
      type: index % 7 === 0 ? "Ride" : "Run",
      distanceKm: 8 + (index % 28),
      theme: index % 3 === 0 ? "Exploratory" : "Mountain",
      guide: { reviewStatus: "draft", vibe: index % 3 === 0 ? "playful" : "wild" },
    });
    return {
      id: `synthetic-candidate-${index}`,
      sourceRouteSlug: route.slug,
      sourceLabel: "Owner-curated from recorded GPX",
      terrain: index % 4 === 0 ? ["trail", "mountain"] : ["road", "mixed"],
      vibes: index % 3 === 0 ? ["playful", "exploratory"] : ["wild", "mountain"],
      route,
    };
  });
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

function withArrayContents<T, R>(target: T[], replacement: T[], run: () => R): R {
  const original = [...target];
  target.splice(0, target.length, ...replacement);
  try {
    return run();
  } finally {
    target.splice(0, target.length, ...original);
  }
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
  const synthetic2_500 = syntheticSummaries(2_500);
  const synthetic10_000Candidates = syntheticCandidates(10_000);
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

  const lookupQueries = Array.from({ length: 5_000 }, (_, index) =>
    index % 7 === 0 ? `missing-${index}` : synthetic2_500[index % synthetic2_500.length].slug,
  );
  const routeLookupBenchmark = withArrayContents(routes, synthetic2_500, () =>
    benchmark({
      name: "route-lookup-2,500-routes",
      operationsPerSample: lookupQueries.length,
      samples: 15,
      run: () => lookupQueries.map((slug) => findRouteBySlug(slug)?.slug ?? "missing"),
      digest: (result) => ({ count: result.length, digest: stableDigest(result) }),
    }),
  );

  const regionBenchmark = benchmark({
    name: "region-build-2,500-routes",
    operationsPerSample: synthetic2_500.length,
    samples: 20,
    run: () => buildRouteRegions(synthetic2_500),
    digest: (result) => ({
      count: result.length,
      orderDigest: stableDigest(result.map((region) => `${region.name}:${region.routes.length}`)),
    }),
  });

  const filterMatrix: RouteFilters[] = [
    {
      query: "synthetic route 24",
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
      region: "Region 024",
      distance: "20-50",
      climb: "250-750",
      vibe: "Exploratory",
    },
    {
      query: "region 011",
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
      vibe: "Mountain",
    },
  ];
  const routeFilterBenchmark = benchmark({
    name: "routes-filter-matrix-2,500-routes",
    operationsPerSample: synthetic2_500.length * filterMatrix.length,
    samples: 25,
    run: () => filterMatrix.map((filters) => filterRoutes(synthetic2_500, filters)),
    digest: (result) => ({
      counts: result.map((routesForFilter) => routesForFilter.length),
      digests: result.map((routesForFilter) => stableDigest(routesForFilter.map((route) => route.slug))),
    }),
  });

  const finderIntent: FinderIntent = {
    place: "Kyoto",
    activity: "Run",
    distanceKm: 15,
    terrain: "trail",
    vibe: "playful exploratory",
  };
  const finderBenchmark = withArrayContents(
    curatedDiscoveryCandidates,
    synthetic10_000Candidates,
    () =>
      benchmark({
        name: "finder-search-10,000-candidates",
        operationsPerSample: synthetic10_000Candidates.length,
        samples: 25,
        run: () => curatedRouteDiscoveryProvider.search(finderIntent),
        digest: (result) => ({
          status: result.status,
          count: result.candidates.length,
          digest: stableDigest(result.candidates.map((candidate) => candidate.id)),
        }),
      }),
  );

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
  expect((finderBenchmark.resultDigest as { status: string }).status).toBe("matches");
  expect((regionBenchmark.resultDigest as { count: number }).count).toBe(125);

  const report = {
    schemaVersion: 1,
    environment: environmentMetadata(),
    corpus: {
      currentManifestBytes: Buffer.byteLength(manifestText),
      currentRouteCount: routes.length,
      currentCompletedRouteCount: completedRoutes.length,
      currentDetailCount: fs.readdirSync(DETAIL_DIR).filter((file) => file.endsWith(".json")).length,
      syntheticRouteCount: synthetic2_500.length,
      syntheticFinderCandidateCount: synthetic10_000Candidates.length,
      syntheticLongRoutePointCount: synthetic50_000PointRoute.route.length,
      largestCurrentDetailSlug: largestDetail.slug,
      largestCurrentDetailPointCount: largestDetail.route.length,
    },
    benchmarks: [
      manifestBenchmark,
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
