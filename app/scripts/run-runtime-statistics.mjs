import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const runId =
  process.env.GODIESEL_PERF_RUN_ID ??
  new Date().toISOString().replace(/[:.]/g, "-");
const sourceCommit = git(["rev-parse", "HEAD"]);
const warmups = process.env.GODIESEL_PERF_BROWSER_WARMUPS ?? "3";
const surfaceRepetitions =
  process.env.GODIESEL_PERF_BROWSER_REPETITIONS ?? "100";
const lifecycleRepetitions =
  process.env.GODIESEL_PERF_LIFECYCLE_REPETITIONS ?? "5";
const nodeSamples = process.env.GODIESEL_PERF_NODE_SAMPLES ?? "100";
const profileRepetitions =
  process.env.GODIESEL_PERF_PROFILE_REPETITIONS ?? "20";
const rawDirectory = path.resolve("artifacts/runtime-statistics/raw", runId);
const outputDirectory = path.resolve("artifacts/runtime-statistics", runId);

let activeChild;
let receivedSignal;
let forceKillTimer;

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

export function assertSourceState(expectedCommit, stage) {
  const currentCommit = git(["rev-parse", "HEAD"]);
  const trackedChanges = git(["status", "--porcelain", "--untracked-files=no"]);
  if (currentCommit !== expectedCommit || trackedChanges) {
    throw new Error(
      `Runtime evidence source changed during ${stage}: expected clean ${expectedCommit}, received ${currentCommit}${trackedChanges ? ` with tracked changes:\n${trackedChanges}` : ""}`,
    );
  }
}

export function signalProcessGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

function terminateActiveProcessGroup(signal) {
  if (!activeChild?.pid) return;
  const processGroupId = activeChild.pid;
  signalProcessGroup(processGroupId, signal);
  if (signal !== "SIGKILL") {
    clearTimeout(forceKillTimer);
    forceKillTimer = setTimeout(() => {
      signalProcessGroup(processGroupId, "SIGKILL");
    }, 5_000);
    forceKillTimer.unref();
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    receivedSignal = signal;
    terminateActiveProcessGroup(signal);
  });
}

async function run(command, args, overrides = {}, allowFailure = false) {
  assertSourceState(sourceCommit, `before ${command}`);
  const status = await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      detached: true,
      env: {
        ...process.env,
        GODIESEL_PERF_RUN_ID: runId,
        GODIESEL_PERF_SOURCE_COMMIT: sourceCommit,
        ...overrides,
      },
    });
    activeChild = child;
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (receivedSignal && child.pid) {
        signalProcessGroup(child.pid, "SIGKILL");
      }
      clearTimeout(forceKillTimer);
      activeChild = undefined;
      resolve(code ?? (signal ? 128 : 1));
    });
  });
  assertSourceState(sourceCommit, `after ${command}`);
  if (receivedSignal) {
    throw new Error(`Runtime evidence run cancelled by ${receivedSignal}`);
  }
  if (status !== 0 && !allowFailure) {
    throw new Error(`${command} ${args.join(" ")} exited with ${status}`);
  }
  return status;
}

export function validBrowserReportIndexes(
  directory,
  projectName,
  workload,
  expectedCommit,
) {
  if (!fs.existsSync(directory)) return [];
  const expression = new RegExp(
    `^runtime-browser-${projectName}-${workload}-r(\\d+)\\.json$`,
  );
  return [...new Set(
    fs.readdirSync(directory).flatMap((filename) => {
      const match = filename.match(expression);
      if (!match) return [];
      try {
        const report = JSON.parse(
          fs.readFileSync(path.join(directory, filename), "utf8"),
        );
        return report.status === "passed" &&
          report.sourceCommit === expectedCommit &&
          report.projectName === projectName &&
          report.workload === workload &&
          report.phase === "measured" &&
          report.repetitionIndex === Number(match[1])
          ? [Number(match[1])]
          : [];
      } catch {
        return [];
      }
    }),
  )].sort((left, right) => left - right);
}

function browserReportIndexes(projectName, workload) {
  return validBrowserReportIndexes(
    path.join(rawDirectory, "browser", "measured"),
    projectName,
    workload,
    sourceCommit,
  );
}

function archiveFailures(label) {
  const testResults = path.resolve("test-results");
  if (!fs.existsSync(testResults)) return undefined;
  const destination = path.join(rawDirectory, "failures", label);
  fs.mkdirSync(destination, { recursive: true });
  fs.cpSync(testResults, destination, { recursive: true });
  return path.relative(rawDirectory, destination);
}

async function collectMeasuredSurfaces() {
  const projects = ["desktop-chromium", "mobile-chromium"];
  const target = Number.parseInt(surfaceRepetitions, 10);
  const attempts = [];
  if (
    projects.every(
      (project) => browserReportIndexes(project, "surfaces").length === 0,
    )
  ) {
    const status = await run(
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
      const status = await run(
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
  const ledgerPath = path.join(rawDirectory, "attempt-ledger.json");
  const temporaryPath = `${ledgerPath}.${process.pid}.tmp`;
  fs.writeFileSync(
    temporaryPath,
    `${JSON.stringify(
      {
        runId,
        sourceCommit,
        requestedSuccessfulRepetitionsPerProject: target,
        attempts,
        successfulReports: Object.fromEntries(
          projects.map((project) => [
            project,
            browserReportIndexes(project, "surfaces").length,
          ]),
        ),
      },
      null,
      2,
    )}\n`,
  );
  fs.renameSync(temporaryPath, ledgerPath);
}

async function runLiveProviderLane() {
  const repetitions = Number.parseInt(
    process.env.GODIESEL_PERF_LIVE_REPETITIONS ?? "0",
    10,
  );
  if (!Number.isInteger(repetitions) || repetitions <= 0) {
    throw new Error(
      "GODIESEL_PERF_LIVE_REPETITIONS must be an owner-approved positive integer",
    );
  }
  await run(
    "npm",
    [
      "exec",
      "playwright",
      "--",
      "test",
      "--config",
      "playwright.runtime-live-perf.config.ts",
      `--repeat-each=${repetitions}`,
    ],
    { GODIESEL_LIVE_PROVIDER_PERF: "1" },
  );
  await run(
    "node",
    ["scripts/runtime-statistics.mjs", rawDirectory, outputDirectory],
    { GODIESEL_PERF_BROWSER_WARMUPS: "0" },
  );
}

async function main() {
  assertSourceState(sourceCommit, "run start");
  fs.mkdirSync(rawDirectory, { recursive: true });
  if (process.argv.includes("--live")) {
    await runLiveProviderLane();
  } else {
    await run(
      "npm",
      ["exec", "vitest", "--", "run", "--config", "vitest.runtime-perf.config.ts"],
      {
        GODIESEL_PERF_NODE_SAMPLES: nodeSamples,
        GODIESEL_PERF_CAPTURE_PROFILES: "1",
      },
    );
    await run(
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
    await collectMeasuredSurfaces();
    await run(
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
    await run(
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
    await run(
      "node",
      ["scripts/runtime-statistics.mjs", rawDirectory, outputDirectory],
      {
        GODIESEL_PERF_BROWSER_WARMUPS: warmups,
        GODIESEL_PERF_LIVE_BLOCKER:
          process.env.GODIESEL_PERF_LIVE_BLOCKER ??
          "owner-approved live-provider repetition count was not supplied",
      },
    );
  }
  assertSourceState(sourceCommit, "run completion");
  process.stdout.write(`${outputDirectory}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
