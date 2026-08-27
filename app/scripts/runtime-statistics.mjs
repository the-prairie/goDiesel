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

function browserDistributions(reports) {
  const distributions = [];
  const sampleGroups = new Map();
  const transitions = new Map();
  for (const report of reports) {
    for (const sample of report.samples ?? []) {
      const key = `${report.projectName}/${sample.name}`;
      const group = sampleGroups.get(key) ?? [];
      group.push(sample);
      sampleGroups.set(key, group);
    }
    for (const transition of report.transitionSamples ?? []) {
      const group = transitions.get(report.projectName) ?? [];
      group.push(transition);
      transitions.set(report.projectName, group);
    }
  }
  for (const [key, samples] of sampleGroups) {
    const metrics = [
      ["action-latency", "ms", samples.map((sample) => sample.actionLatencyMs)],
      ["heap-used", "bytes", samples.map((sample) => sample.usedHeapBytes)],
      [
        "observation-frame-interval",
        "ms",
        samples.flatMap((sample) => sample.observation.frameIntervalsMs),
      ],
      [
        "observation-long-task",
        "ms",
        samples.flatMap((sample) =>
          sample.observation.longTasks.map((task) => task.duration),
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
        "network-transfer",
        "bytes",
        samples.map((sample) =>
          [...sample.action.resources, ...sample.observation.resources].reduce(
            (sum, resource) => sum + resource.transferSize,
            0,
          ),
        ),
      ],
    ];
    for (const [metric, unit, values] of metrics) {
      pushDistribution(distributions, `browser/${key}/${metric}`, unit, values);
    }
  }
  for (const [project, samples] of transitions) {
    pushDistribution(
      distributions,
      `browser/${project}/lifecycle/detail-latency`,
      "ms",
      samples.map((sample) => sample.detailLatencyMs),
    );
    pushDistribution(
      distributions,
      `browser/${project}/lifecycle/replay-latency`,
      "ms",
      samples.map((sample) => sample.replayLatencyMs),
    );
    pushDistribution(
      distributions,
      `browser/${project}/lifecycle/atlas-return-latency`,
      "ms",
      samples.map((sample) => sample.atlasReturnLatencyMs),
    );
    pushDistribution(
      distributions,
      `browser/${project}/lifecycle/heap-used`,
      "bytes",
      samples.map((sample) => sample.usedHeapBytes),
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
        url: frame.url || "",
        lineNumber: frame.lineNumber,
        samples,
      };
    })
    .sort((left, right) => right.samples - left.samples)
    .slice(0, limit);
}

function topAllocations(profile, limit = 10) {
  const rows = [];
  const visit = (node) => {
    if (!node) return;
    const frame = node.callFrame ?? {};
    rows.push({
      functionName: frame.functionName || "(anonymous)",
      url: frame.url || "",
      selfSize: node.selfSize ?? 0,
    });
    for (const child of node.children ?? []) visit(child);
  };
  visit(profile.head);
  return rows
    .sort((left, right) => right.selfSize - left.selfSize)
    .slice(0, limit);
}

function profileSummary(files, measuredReports, nodeReports) {
  const cpu = files
    .filter((filename) => filename.endsWith("runtime-node.cpuprofile"))
    .map((filename) => ({
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
      },
      webgl: selected.sample.webgl,
      heap: {
        usedBytes: selected.sample.usedHeapBytes,
        totalBytes: selected.sample.totalHeapBytes,
      },
      network: [
        ...selected.sample.action.resources,
        ...selected.sample.observation.resources,
      ],
    });
  }
  return {
    cpu,
    node: nodeReports.map((report) => ({
      environment: report.environment,
      io: report.io,
      memory: (report.benchmarks ?? []).map((benchmark) => ({
        name: benchmark.name,
        before: benchmark.memoryBefore,
        after: benchmark.memoryAfter,
      })),
    })),
    browser,
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
  const nodeReports = jsonFiles
    .filter((filename) => filename.endsWith("runtime-node.json"))
    .map(readJson);
  const liveReports = jsonFiles
    .filter((filename) => /runtime-live-provider-.*\.json$/.test(filename))
    .map(readJson);
  const distributions = [
    ...nodeDistributions(nodeReports),
    ...browserDistributions(browserReports),
    ...liveDistributions(liveReports),
  ];
  const cpu = os.cpus();
  const report = {
    schemaVersion: 1,
    sourceCommit,
    generatedAt: new Date().toISOString(),
    protocol: {
      warmups: 3,
      measuredRepetitions: Math.max(
        0,
        ...[...new Set(browserReports.map((report) => report.projectName))].map(
          (projectName) =>
            browserReports.filter(
              (report) =>
                report.projectName === projectName &&
                report.workload === "surfaces",
            ).length,
        ),
      ),
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
      },
      liveProvider:
        liveReports.length > 0
          ? { status: "measured", repetitions: liveReports.length }
          : { status: "unavailable", blocker: liveBlocker ?? "not-run" },
    },
    environment: {
      hostname: os.hostname(),
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
