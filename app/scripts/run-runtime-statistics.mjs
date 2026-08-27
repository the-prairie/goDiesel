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

function run(command, args, overrides = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: { ...process.env, GODIESEL_PERF_RUN_ID: runId, ...overrides },
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} exited with ${result.status}`,
    );
  }
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
run(
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
  {
    GODIESEL_PERF_WORKLOAD: "surfaces",
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
