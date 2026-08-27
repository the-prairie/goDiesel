import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const runId =
  process.env.GODIESEL_PERF_RUN_ID ??
  new Date().toISOString().replace(/[:.]/g, "-");
const warmups = process.env.GODIESEL_PERF_BROWSER_WARMUPS ?? "3";
const surfaceRepetitions =
  process.env.GODIESEL_PERF_BROWSER_REPETITIONS ?? "100";
const lifecycleRepetitions =
  process.env.GODIESEL_PERF_LIFECYCLE_REPETITIONS ?? "5";
const nodeSamples = process.env.GODIESEL_PERF_NODE_SAMPLES ?? "100";
const profileRepetitions = process.env.GODIESEL_PERF_PROFILE_REPETITIONS ?? "5";
const rawDirectory = path.resolve("artifacts/runtime-statistics/raw", runId);
const outputDirectory = path.resolve("artifacts/runtime-statistics", runId);

function run(command, args, overrides = {}, allowFailure = false) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: { ...process.env, GODIESEL_PERF_RUN_ID: runId, ...overrides },
  });
  if (result.status !== 0 && !allowFailure) {
    throw new Error(
      `${command} ${args.join(" ")} exited with ${result.status}`,
    );
  }
  return result.status ?? 1;
}

function browserReportIndexes(projectName, workload) {
  const directory = path.join(rawDirectory, "browser", "measured");
  if (!fs.existsSync(directory)) return [];
  const expression = new RegExp(
    `^runtime-browser-${projectName}-${workload}-r(\\d+)\\.json$`,
  );
  return fs
    .readdirSync(directory)
    .map((filename) => filename.match(expression)?.[1])
    .filter(Boolean)
    .map(Number)
    .sort((left, right) => left - right);
}

function archiveFailures(label) {
  const testResults = path.resolve("test-results");
  if (!fs.existsSync(testResults)) return undefined;
  const destination = path.join(rawDirectory, "failures", label);
  fs.mkdirSync(destination, { recursive: true });
  fs.cpSync(testResults, destination, { recursive: true });
  return path.relative(rawDirectory, destination);
}

function collectMeasuredSurfaces() {
  const projects = ["desktop-chromium", "mobile-chromium"];
  const target = Number.parseInt(surfaceRepetitions, 10);
  const attempts = [];
  if (
    projects.every(
      (project) => browserReportIndexes(project, "surfaces").length === 0,
    )
  ) {
    const status = run(
      "npm",
      [
        "exec",
        "playwright",
        "--",
        "test",
        "--config",
        "playwright.runtime-perf.config.ts",
        `--repeat-each=${surfaceRepetitions}`,
      ],
      { GODIESEL_PERF_WORKLOAD: "surfaces", GODIESEL_PERF_PHASE: "measured" },
      true,
    );
    attempts.push({
      phase: "initial",
      status,
      diagnostics:
        status === 0 ? undefined : archiveFailures("measured-initial"),
    });
  }
  for (const project of projects) {
    for (
      let supplementalAttempt = 1;
      supplementalAttempt <= 3;
      supplementalAttempt += 1
    ) {
      const indexes = browserReportIndexes(project, "surfaces");
      const missing = target - indexes.length;
      if (missing <= 0) break;
      const offset = (indexes.at(-1) ?? -1) + 1;
      const status = run(
        "npm",
        [
          "exec",
          "playwright",
          "--",
          "test",
          "--config",
          "playwright.runtime-perf.config.ts",
          `--project=${project}`,
          `--repeat-each=${missing}`,
        ],
        {
          GODIESEL_PERF_WORKLOAD: "surfaces",
          GODIESEL_PERF_PHASE: "measured",
          GODIESEL_PERF_REPETITION_OFFSET: String(offset),
        },
        true,
      );
      attempts.push({
        project,
        phase: "supplemental",
        supplementalAttempt,
        offset,
        attempted: missing,
        status,
        diagnostics:
          status === 0
            ? undefined
            : archiveFailures(
                `measured-${project}-supplemental-${supplementalAttempt}`,
              ),
      });
    }
    const successful = browserReportIndexes(project, "surfaces").length;
    if (successful < target) {
      throw new Error(
        `${project} produced ${successful}/${target} successful surface reports after three supplemental attempts`,
      );
    }
  }
  fs.writeFileSync(
    path.join(rawDirectory, "attempt-ledger.json"),
    `${JSON.stringify({ runId, requestedSuccessfulRepetitionsPerProject: target, attempts, successfulReports: Object.fromEntries(projects.map((project) => [project, browserReportIndexes(project, "surfaces").length])) }, null, 2)}\n`,
  );
}

fs.mkdirSync(rawDirectory, { recursive: true });
run(
  "npm",
  ["exec", "vitest", "--", "run", "--config", "vitest.runtime-perf.config.ts"],
  {
    GODIESEL_PERF_NODE_SAMPLES: nodeSamples,
    GODIESEL_PERF_CAPTURE_PROFILES: "1",
  },
);
run(
  "npm",
  [
    "exec",
    "playwright",
    "--",
    "test",
    "--config",
    "playwright.runtime-perf.config.ts",
    `--repeat-each=${warmups}`,
  ],
  {
    GODIESEL_PERF_WORKLOAD: "surfaces",
    GODIESEL_PERF_PHASE: "warmup",
  },
);
collectMeasuredSurfaces();
run(
  "npm",
  [
    "exec",
    "playwright",
    "--",
    "test",
    "--config",
    "playwright.runtime-perf.config.ts",
    `--repeat-each=${lifecycleRepetitions}`,
  ],
  {
    GODIESEL_PERF_WORKLOAD: "lifecycle",
    GODIESEL_PERF_PHASE: "measured",
  },
);
run(
  "npm",
  [
    "exec",
    "playwright",
    "--",
    "test",
    "--config",
    "playwright.runtime-perf.config.ts",
    `--repeat-each=${profileRepetitions}`,
  ],
  {
    GODIESEL_PERF_WORKLOAD: "surfaces",
    GODIESEL_PERF_PHASE: "profile",
    GODIESEL_PERF_CAPTURE_PROFILES: "1",
  },
);
run("node", ["scripts/runtime-statistics.mjs", rawDirectory, outputDirectory], {
  GODIESEL_PERF_LIVE_BLOCKER:
    process.env.GODIESEL_PERF_LIVE_BLOCKER ??
    "owner-approved live-provider repetition count was not supplied",
});

process.stdout.write(`${outputDirectory}\n`);
