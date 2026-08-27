import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const QUANTILES = [
  ["p50", 0.5, 2],
  ["p95", 0.95, 20],
  ["p99", 0.99, 100],
];

function finite(values) {
  return values.filter((value) => Number.isFinite(value));
}

function nearestRank(sorted, quantile) {
  return sorted[Math.max(0, Math.ceil(quantile * sorted.length) - 1)];
}

export function summarizeDistribution(name, unit, observations) {
  const sorted = finite(observations).sort((left, right) => left - right);
  if (sorted.length === 0)
    throw new Error(`${name} has no finite observations`);
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const sampleVariance =
    sorted.length > 1
      ? sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
        (sorted.length - 1)
      : 0;
  const median = nearestRank(sorted, 0.5);
  const deviations = sorted
    .map((value) => Math.abs(value - median))
    .sort((left, right) => left - right);
  const quantiles = Object.fromEntries(
    QUANTILES.map(([label, quantile, minimumSamples]) => [
      label,
      {
        value:
          sorted.length >= minimumSamples
            ? nearestRank(sorted, quantile)
            : null,
        status:
          sorted.length >= minimumSamples
            ? "available"
            : "insufficient-samples",
        minimumSamples,
      },
    ]),
  );
  return {
    name,
    unit,
    sampleCount: sorted.length,
    min: sorted[0],
    max: sorted.at(-1),
    mean,
    sampleStdDev: Math.sqrt(sampleVariance),
    coefficientOfVariation:
      mean === 0 ? null : Math.sqrt(sampleVariance) / mean,
    medianAbsoluteDeviation: nearestRank(deviations, 0.5),
    ...quantiles,
  };
}

function walkFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(entryPath) : [entryPath];
  });
}

function readJson(filename) {
  return JSON.parse(fs.readFileSync(filename, "utf8"));
}

function artifactRecord(filename, root, retention = "local-artifact") {
  const contents = fs.readFileSync(filename);
  return {
    kind: path.extname(filename).slice(1) || "file",
    path: path.relative(root, filename),
    bytes: contents.byteLength,
    sha256: crypto.createHash("sha256").update(contents).digest("hex"),
    retention,
  };
}

function pushDistribution(distributions, name, unit, values) {
  if (finite(values).length > 0) {
    distributions.push(summarizeDistribution(name, unit, values));
  }
}

function browserNetworkEntries(sample) {
  return [
    ...(sample.navigation ? [sample.navigation] : []),
    ...(sample.action?.resources ?? []),
    ...(sample.observation?.resources ?? []),
  ];
}

function browserDistributions(reports, profileReports = []) {
  const distributions = [];
  const sampleGroups = new Map();
  const lifecycleReports = new Map();
  for (const report of reports) {
    for (const sample of report.samples ?? []) {
      const key = `${report.projectName}/${sample.name}`;
      const group = sampleGroups.get(key) ?? [];
      group.push(sample);
      sampleGroups.set(key, group);
    }
    if (report.workload === "lifecycle") {
      const group = lifecycleReports.get(report.projectName) ?? [];
      group.push(report);
      lifecycleReports.set(report.projectName, group);
    }
  }
  for (const [key, samples] of sampleGroups) {
    const resources = browserNetworkEntries;
    const metrics = [
      ["action-latency", "ms", samples.map((sample) => sample.actionLatencyMs)],
      ["heap-used", "bytes", samples.map((sample) => sample.usedHeapBytes)],
      [
        "heap-delta-after-gc",
        "bytes",
        samples.map(
          (sample) => sample.usedHeapBytes - sample.heapBefore.usedBytes,
        ),
      ],
      [
        "peak-observed-heap",
        "bytes",
        samples.map((sample) => sample.peakObservedHeapBytes),
      ],
      [
        "observation-frame-p95-interval",
        "ms",
        samples.map((sample) => sample.observation.frameP95Ms),
      ],
      [
        "observation-frame-rate-at-p95",
        "fps",
        samples.map((sample) => sample.observation.estimatedFpsP95),
      ],
      [
        "observation-long-task",
        "ms",
        samples.flatMap((sample) =>
          sample.observation.longTasks.map((task) => task.duration),
        ),
      ],
      [
        "long-task-count",
        "count",
        samples.map(
          (sample) =>
            sample.action.longTasks.length +
            sample.observation.longTasks.length,
        ),
      ],
      [
        "long-task-total-duration",
        "ms",
        samples.map((sample) =>
          [...sample.action.longTasks, ...sample.observation.longTasks].reduce(
            (sum, task) => sum + task.duration,
            0,
          ),
        ),
      ],
      [
        "react-actual-duration",
        "ms",
        samples.map((sample) => sample.action.reactActualDurationMs),
      ],
      [
        "react-tree-base-duration",
        "ms",
        samples.map((sample) => sample.action.reactTreeBaseDurationMs),
      ],
      [
        "script-execution-duration",
        "ms",
        samples.map(
          (sample) =>
            sample.action.scriptDurationDeltaMs +
            sample.observation.scriptDurationDeltaMs,
        ),
      ],
      [
        "script-compile-duration",
        "ms",
        samples.map(
          (sample) =>
            sample.action.v8CompileDurationDeltaMs +
            sample.observation.v8CompileDurationDeltaMs,
        ),
      ],
      [
        "network-request-count",
        "count",
        samples.map((sample) => resources(sample).length),
      ],
      [
        "network-transfer",
        "bytes",
        samples.map((sample) =>
          resources(sample).reduce(
            (sum, resource) => sum + resource.transferSize,
            0,
          ),
        ),
      ],
      [
        "javascript-transfer",
        "bytes",
        samples.map((sample) =>
          resources(sample)
            .filter(
              (resource) =>
                resource.initiatorType === "script" ||
                resource.name.endsWith(".js"),
            )
            .reduce((sum, resource) => sum + resource.transferSize, 0),
        ),
      ],
    ];
    for (const [metric, unit, values] of metrics) {
      pushDistribution(distributions, `browser/${key}/${metric}`, unit, values);
    }
  }
  for (const [project, projectReports] of lifecycleReports) {
    const samples = projectReports.flatMap(
      (report) => report.transitionSamples ?? [],
    );
    const independentSequences = new Set(
      projectReports.map((report) => report.repetitionIndex),
    ).size;
    const metrics = [
      ["detail-latency", "ms", samples.map((sample) => sample.detailLatencyMs)],
      ["replay-latency", "ms", samples.map((sample) => sample.replayLatencyMs)],
      [
        "atlas-return-latency",
        "ms",
        samples.map((sample) => sample.atlasReturnLatencyMs),
      ],
    ];
    for (const [metric, unit, values] of metrics) {
      const summary = summarizeDistribution(
        `browser/${project}/lifecycle/${metric}`,
        unit,
        values,
      );
      summary.independentSequenceCount = independentSequences;
      summary.observationsPerSequence = samples.length / independentSequences;
      for (const [label, , minimumSamples] of QUANTILES) {
        if (independentSequences < minimumSamples) {
          summary[label] = {
            value: null,
            status: "insufficient-samples",
            minimumSamples,
          };
        }
      }
      distributions.push(summary);
    }
    const finalHeapUsed = projectReports.map(
      (report) => report.transitionSamples.at(-1).usedHeapBytes,
    );
    const finalHeapDelta = projectReports.map(
      (report) =>
        report.transitionSamples.at(-1).usedHeapBytes -
        report.lifecycleBaselineHeapBytes,
    );
    const finalHeapRatio = projectReports.map(
      (report) =>
        report.transitionSamples.at(-1).usedHeapBytes /
        report.lifecycleBaselineHeapBytes,
    );
    for (const [metric, unit, values] of [
      ["final-heap-used", "bytes", finalHeapUsed],
      ["final-heap-delta", "bytes", finalHeapDelta],
      ["final-heap-ratio", "ratio", finalHeapRatio],
    ]) {
      const summary = summarizeDistribution(
        `browser/${project}/lifecycle/${metric}`,
        unit,
        values,
      );
      summary.independentSequenceCount = independentSequences;
      summary.observationsPerSequence = 1;
      distributions.push(summary);
    }
  }
  const reactGroups = new Map();
  for (const report of profileReports) {
    for (const sample of report.samples ?? []) {
      const key = `${report.projectName}/${sample.name}`;
      const values = reactGroups.get(key) ?? [];
      values.push(...sample.action.reactCommitDurationsMs);
      reactGroups.set(key, values);
    }
  }
  for (const [key, values] of reactGroups) {
    pushDistribution(
      distributions,
      `browser-profile/${key}/react-expensive-commit-duration`,
      "ms",
      values,
    );
  }
  return distributions;
}

function nodeDistributions(reports) {
  const groups = new Map();
  for (const report of reports) {
    for (const benchmark of report.benchmarks ?? []) {
      const group = groups.get(benchmark.name) ?? [];
      group.push(...benchmark.samplesMs);
      groups.set(benchmark.name, group);
    }
  }
  return [...groups].map(([name, values]) =>
    summarizeDistribution(`node/${name}`, "ms", values),
  );
}

function liveDistributions(reports) {
  const distributions = [];
  pushDistribution(
    distributions,
    "live-provider/global-ready",
    "ms",
    reports.map((report) => report.globalReadyMs),
  );
  pushDistribution(
    distributions,
    "live-provider/regional-settlement",
    "ms",
    reports.map((report) => report.regionalSettlementMs),
  );
  pushDistribution(
    distributions,
    "live-provider/local-application-ready",
    "ms",
    reports.map((report) => report.localApplicationReadyMs),
  );
  pushDistribution(
    distributions,
    "live-provider/global-provider-settlement",
    "ms",
    reports.map((report) => report.globalProviderSettlementMs),
  );
  return distributions;
}

function topCpuFrames(profile, limit = 10) {
  const nodes = new Map((profile.nodes ?? []).map((node) => [node.id, node]));
  const hits = new Map();
  for (const id of profile.samples ?? []) hits.set(id, (hits.get(id) ?? 0) + 1);
  return [...hits.entries()]
    .map(([id, samples]) => {
      const frame = nodes.get(id)?.callFrame ?? {};
      return {
        functionName: frame.functionName || "(anonymous)",
        url: normalizeProfileUrl(frame.url),
        lineNumber: frame.lineNumber,
        samples,
      };
    })
    .sort((left, right) => right.samples - left.samples)
    .slice(0, limit);
}

export function normalizeProfileUrl(url = "") {
  const decoded = decodeURIComponent(url);
  const appRoot = process.cwd();
  if (decoded.startsWith(`file://${appRoot}/`)) {
    return `<app>/${decoded.slice(`file://${appRoot}/`.length)}`;
  }
  const nodeModulesMarker = "/node_modules/";
  const nodeModulesIndex = decoded.indexOf(nodeModulesMarker);
  if (nodeModulesIndex >= 0) {
    return `<node_modules>/${decoded.slice(nodeModulesIndex + nodeModulesMarker.length)}`;
  }
  if (decoded.startsWith("file://")) {
    return `<system>/${path.basename(new URL(decoded).pathname)}`;
  }
  if (path.isAbsolute(decoded)) {
    return `<system>/${path.basename(decoded)}`;
  }
  return decoded;
}

function topAllocations(profile, limit = 10) {
  const rows = [];
  const visit = (node) => {
    if (!node) return;
    const frame = node.callFrame ?? {};
    rows.push({
      functionName: frame.functionName || "(anonymous)",
      url: normalizeProfileUrl(frame.url),
      selfSize: node.selfSize ?? 0,
    });
    for (const child of node.children ?? []) visit(child);
  };
  visit(profile.head);
  return rows
    .sort((left, right) => right.selfSize - left.selfSize)
    .slice(0, limit);
}

function heapSnapshotGroups(filename) {
  const profile = readJson(filename);
  const fields = profile.snapshot?.meta?.node_fields ?? [];
  const typeNames = profile.snapshot?.meta?.node_types?.[0] ?? [];
  const typeIndex = fields.indexOf("type");
  const nameIndex = fields.indexOf("name");
  const selfSizeIndex = fields.indexOf("self_size");
  if (typeIndex < 0 || nameIndex < 0 || selfSizeIndex < 0) {
    throw new Error(`Heap snapshot lacks required node fields: ${filename}`);
  }
  const width = fields.length;
  const groups = new Map();
  for (let offset = 0; offset < profile.nodes.length; offset += width) {
    const type = typeNames[profile.nodes[offset + typeIndex]] ?? "unknown";
    const name = profile.strings[profile.nodes[offset + nameIndex]] ?? "";
    const key = `${type}:${name}`;
    const current = groups.get(key) ?? { type, name, count: 0, selfSize: 0 };
    current.count += 1;
    current.selfSize += profile.nodes[offset + selfSizeIndex] ?? 0;
    groups.set(key, current);
  }
  return groups;
}

function topHeapGrowth(baselineFilename, finalFilename, limit = 20) {
  const baseline = heapSnapshotGroups(baselineFilename);
  const final = heapSnapshotGroups(finalFilename);
  return [...final.entries()]
    .map(([key, value]) => {
      const before = baseline.get(key) ?? { count: 0, selfSize: 0 };
      return {
        type: value.type,
        name: value.name,
        countDelta: value.count - before.count,
        selfSizeDelta: value.selfSize - before.selfSize,
      };
    })
    .filter((row) => row.countDelta > 0 || row.selfSizeDelta > 0)
    .sort((left, right) => right.selfSizeDelta - left.selfSizeDelta)
    .slice(0, limit);
}

function profileSummary(files, measuredReports, nodeReports) {
  const cpu = files
    .filter((filename) => /runtime-node-.*\.cpuprofile$/.test(filename))
    .map((filename) => ({
      benchmark: path.basename(filename).replace(/^runtime-node-|\.cpuprofile$/g, ""),
      path: path.relative(process.cwd(), filename),
      topFrames: topCpuFrames(readJson(filename)),
    }));
  const profileReports = files
    .filter((filename) => /runtime-browser-.*\.json$/.test(filename))
    .map(readJson)
    .filter((report) => report.phase === "profile");
  const measuredByScenario = new Map();
  for (const report of measuredReports) {
    for (const sample of report.samples ?? []) {
      const key = `${report.projectName}/${sample.name}`;
      const values = measuredByScenario.get(key) ?? [];
      values.push(sample.actionLatencyMs);
      measuredByScenario.set(key, values);
    }
  }
  const candidatesByScenario = new Map();
  for (const report of profileReports) {
    for (const sample of report.samples ?? []) {
      const key = `${report.projectName}/${sample.name}`;
      const candidates = candidatesByScenario.get(key) ?? [];
      candidates.push({ report, sample });
      candidatesByScenario.set(key, candidates);
    }
  }
  const browser = [];
  for (const [key, candidates] of candidatesByScenario) {
    const measured = (measuredByScenario.get(key) ?? []).sort(
      (left, right) => left - right,
    );
    if (measured.length === 0) continue;
    const targetMedianMs = nearestRank(measured, 0.5);
    const selected = candidates.sort(
      (left, right) =>
        Math.abs(left.sample.actionLatencyMs - targetMedianMs) -
        Math.abs(right.sample.actionLatencyMs - targetMedianMs),
    )[0];
    const cpuPath = path.resolve(
      process.cwd(),
      selected.sample.profileArtifacts.cpu,
    );
    const allocationPath = path.resolve(
      process.cwd(),
      selected.sample.profileArtifacts.allocation,
    );
    const network = browserNetworkEntries(selected.sample);
    browser.push({
      projectName: selected.report.projectName,
      name: selected.sample.name,
      targetMedianMs,
      selectedActionLatencyMs: selected.sample.actionLatencyMs,
      repetitionIndex: selected.report.repetitionIndex,
      selectionRule:
        "minimum absolute distance from the unprofiled measured median",
      cpu: {
        path: path.relative(process.cwd(), cpuPath),
        topFrames: topCpuFrames(readJson(cpuPath)),
      },
      allocation: {
        path: path.relative(process.cwd(), allocationPath),
        topAllocations: topAllocations(readJson(allocationPath)),
      },
      react: {
        commits: selected.sample.action.reactCommits,
        actualDurationMs: selected.sample.action.reactActualDurationMs,
        treeBaseDurationMs: selected.sample.action.reactTreeBaseDurationMs,
        commitProfiles: selected.sample.action.reactCommitProfiles,
      },
      webgl: selected.sample.webgl,
      heap: {
        beforeUsedBytes: selected.sample.heapBefore.usedBytes,
        usedBytes: selected.sample.usedHeapBytes,
        totalBytes: selected.sample.totalHeapBytes,
        deltaAfterGcBytes:
          selected.sample.usedHeapBytes - selected.sample.heapBefore.usedBytes,
        peakObservedBytes: selected.sample.peakObservedHeapBytes,
      },
      network: {
        resourceCount: network.length,
        transferBytes: network.reduce(
          (sum, resource) => sum + resource.transferSize,
          0,
        ),
        decodedBodyBytes: network.reduce(
          (sum, resource) => sum + resource.decodedBodySize,
          0,
        ),
        localResourceCount: network.filter(
          (resource) => resource.origin === "local",
        ).length,
        fixtureResourceCount: network.filter(
          (resource) => resource.origin === "fixture",
        ).length,
        providerResourceCount: network.filter(
          (resource) => resource.origin === "provider",
        ).length,
        slowestResources: network
          .sort((left, right) => right.duration - left.duration)
          .slice(0, 10),
      },
    });
  }
  const lifecycleHeap = profileReports
    .filter((report) => report.lifecycleHeapProfileArtifacts)
    .map((report) => {
      const baseline = path.resolve(
        process.cwd(),
        report.lifecycleHeapProfileArtifacts.baseline,
      );
      const final = path.resolve(
        process.cwd(),
        report.lifecycleHeapProfileArtifacts.final,
      );
      return {
        projectName: report.projectName,
        repetitionIndex: report.repetitionIndex,
        baselineUsedHeapBytes: report.lifecycleBaselineHeapBytes,
        finalUsedHeapBytes: report.transitionSamples?.at(-1)?.usedHeapBytes,
        retainedHeapRatio:
          report.transitionSamples?.at(-1)?.usedHeapBytes /
          report.lifecycleBaselineHeapBytes,
        baseline: path.relative(process.cwd(), baseline),
        final: path.relative(process.cwd(), final),
        topSelfSizeGrowth: topHeapGrowth(baseline, final),
      };
    });
  return {
    cpu,
    node: nodeReports.map((report) => ({
      environment: {
        ...report.environment,
        processArgs: report.environment?.processArgs?.map(normalizeProfileUrl),
      },
      io: report.io,
      memory: (report.benchmarks ?? []).map((benchmark) => ({
        name: benchmark.name,
        before: benchmark.memoryBefore,
        after: benchmark.memoryAfter,
      })),
    })),
    browser,
    lifecycleHeap,
  };
}

export function aggregateRuntimeStatistics({
  rawDirectory,
  outputDirectory,
  sourceCommit,
  liveBlocker,
}) {
  const files = walkFiles(rawDirectory);
  const jsonFiles = files.filter((filename) => filename.endsWith(".json"));
  const browserReports = jsonFiles
    .filter((filename) => /runtime-browser-.*\.json$/.test(filename))
    .map(readJson)
    .filter((report) => report.phase === "measured");
  const profileReports = jsonFiles
    .filter((filename) => /runtime-browser-.*\.json$/.test(filename))
    .map(readJson)
    .filter((report) => report.phase === "profile");
  const nodeReports = jsonFiles
    .filter((filename) => filename.endsWith("runtime-node.json"))
    .map(readJson);
  const liveReports = jsonFiles
    .filter((filename) => /runtime-live-provider-.*\.json$/.test(filename))
    .map(readJson);
  const sourceReports = [
    ...browserReports,
    ...profileReports,
    ...nodeReports,
    ...liveReports,
  ];
  const mismatchedSources = sourceReports.filter(
    (report) => report.sourceCommit !== sourceCommit,
  );
  if (mismatchedSources.length > 0) {
    throw new Error(
      `${mismatchedSources.length} raw reports do not match source commit ${sourceCommit}`,
    );
  }
  const nonPassingReports = sourceReports.filter(
    (report) => report.status !== "passed",
  );
  if (nonPassingReports.length > 0) {
    throw new Error(
      `${nonPassingReports.length} raw reports are not atomic passed reports`,
    );
  }
  const invalidLifecycleReports = browserReports.filter(
    (report) =>
      report.workload === "lifecycle" &&
      (!Number.isFinite(report.lifecycleBaselineHeapBytes) ||
        report.lifecycleBaselineHeapBytes <= 0 ||
        report.transitionSamples?.length !== 20),
  );
  if (invalidLifecycleReports.length > 0) {
    throw new Error(
      `${invalidLifecycleReports.length} lifecycle reports lack a settled heap baseline or 20 transitions`,
    );
  }
  const providerResources = [...browserReports, ...profileReports].flatMap(
    (report) =>
      (report.samples ?? []).flatMap((sample) =>
        browserNetworkEntries(sample).filter(
          (resource) => resource.origin === "provider",
        ),
      ),
  );
  if (providerResources.length > 0) {
    throw new Error(
      `Provider-disabled evidence contains ${providerResources.length} external resource timings`,
    );
  }
  const distributions = [
    ...nodeDistributions(nodeReports),
    ...browserDistributions(browserReports, profileReports),
    ...liveDistributions(liveReports),
  ];
  const browserSurfaceCounts = [
    ...new Set(browserReports.map((report) => report.projectName)),
  ].map(
    (projectName) =>
      new Set(
        browserReports
          .filter(
            (report) =>
              report.projectName === projectName &&
              report.workload === "surfaces",
          )
          .map((report) => report.repetitionIndex),
      ).size,
  );
  const liveCounts = [
    ...new Set(liveReports.map((report) => report.projectName)),
  ].map(
    (projectName) =>
      new Set(
        liveReports
          .filter((report) => report.projectName === projectName)
          .map((report) => report.repetitionIndex),
      ).size,
  );
  const measuredRepetitions = Math.max(
    0,
    ...browserSurfaceCounts,
    ...liveCounts,
  );
  if (measuredRepetitions <= 0) {
    throw new Error("Runtime evidence contains no measured repetitions");
  }
  const cpu = os.cpus();
  const report = {
    schemaVersion: 1,
    sourceCommit,
    generatedAt: new Date().toISOString(),
    protocol: {
      warmups: Number.parseInt(
        process.env.GODIESEL_PERF_BROWSER_WARMUPS ?? "3",
        10,
      ),
      measuredRepetitions,
      quantileMethod: "nearest-rank",
      repetitionPlan: {
        nodeSamples: nodeReports[0]?.benchmarks?.[0]?.samplesMs?.length ?? 0,
        browserSurfaceByProject: Object.fromEntries(
          [...new Set(browserReports.map((report) => report.projectName))].map(
            (projectName) => [
              projectName,
              new Set(
                browserReports
                  .filter(
                    (report) =>
                      report.projectName === projectName &&
                      report.workload === "surfaces",
                  )
                  .map((report) => report.repetitionIndex),
              ).size,
            ],
          ),
        ),
        lifecycleSequencesByProject: Object.fromEntries(
          [...new Set(browserReports.map((report) => report.projectName))].map(
            (projectName) => [
              projectName,
              new Set(
                browserReports
                  .filter(
                    (report) =>
                      report.projectName === projectName &&
                      report.workload === "lifecycle",
                  )
                  .map((report) => report.repetitionIndex),
              ).size,
            ],
          ),
        ),
        profileRepetitionsByProject: Object.fromEntries(
          [...new Set(profileReports.map((report) => report.projectName))].map(
            (projectName) => [
              projectName,
              profileReports.filter(
                (report) => report.projectName === projectName,
              ).filter((report) => report.workload === "surfaces").length,
            ],
          ),
        ),
        lifecycleHeapProfilesByProject: Object.fromEntries(
          [...new Set(profileReports.map((report) => report.projectName))].map(
            (projectName) => [
              projectName,
              profileReports.filter(
                (report) =>
                  report.projectName === projectName &&
                  report.workload === "lifecycle" &&
                  report.lifecycleHeapProfileArtifacts,
              ).length,
            ],
          ),
        ),
      },
      hermeticProviderDisabled: {
        successfulExternalResourceCount: providerResources.length,
        deterministicFixtureResourceCount: [
          ...browserReports,
          ...profileReports,
        ].reduce(
          (sum, report) =>
            sum +
            (report.samples ?? []).reduce(
              (sampleSum, sample) =>
                sampleSum +
                browserNetworkEntries(sample).filter(
                  (resource) => resource.origin === "fixture",
                ).length,
              0,
            ),
          0,
        ),
        blockedExternalRequestCount: [
          ...browserReports,
          ...profileReports,
        ].reduce(
          (sum, report) =>
            sum +
            (report.samples ?? []).reduce(
              (sampleSum, sample) =>
                sampleSum + sample.blockedExternalRequests.length,
              0,
            ),
          0,
        ),
      },
      liveProvider:
        liveReports.length > 0
          ? { status: "measured", repetitions: liveReports.length }
          : { status: "unavailable", blocker: liveBlocker ?? "not-run" },
    },
    environment: {
      hostname: "redacted-local-host",
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      cpuModel: cpu[0]?.model ?? "unknown",
      cpuCount: cpu.length,
      totalMemoryBytes: os.totalmem(),
      node: process.version,
    },
    distributions,
    artifacts: files.map((filename) => artifactRecord(filename, process.cwd())),
  };
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(outputDirectory, "statistical-summary.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(outputDirectory, "profile-summary.json"),
    `${JSON.stringify(profileSummary(files, browserReports, nodeReports), null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(outputDirectory, "live-provider-status.json"),
    `${JSON.stringify(report.protocol.liveProvider, null, 2)}\n`,
  );
  return report;
}

function main() {
  const [rawDirectory, outputDirectory] = process.argv.slice(2);
  if (!rawDirectory || !outputDirectory) {
    throw new Error(
      "Usage: node scripts/runtime-statistics.mjs <raw-directory> <output-directory>",
    );
  }
  const sourceCommit =
    process.env.GODIESEL_PERF_SOURCE_COMMIT ??
    execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  aggregateRuntimeStatistics({
    rawDirectory: path.resolve(rawDirectory),
    outputDirectory: path.resolve(outputDirectory),
    sourceCommit,
    liveBlocker: process.env.GODIESEL_PERF_LIVE_BLOCKER,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
