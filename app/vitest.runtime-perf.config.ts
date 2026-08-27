import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    include: [
      "perf/runtime-baseline.perf.ts",
      "perf/runtime-statistics.test.ts",
    ],
    pool: "forks",
    maxWorkers: 1,
    minWorkers: 1,
    testTimeout: 120_000,
  },
});
