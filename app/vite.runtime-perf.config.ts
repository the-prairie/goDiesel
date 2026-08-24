import path from "node:path";
import { defineConfig, mergeConfig, type UserConfig } from "vite";

import baseConfig from "./vite.config";

export default defineConfig(async (environment) => {
  const resolvedBase =
    typeof baseConfig === "function"
      ? await baseConfig(environment)
      : await baseConfig;

  return mergeConfig(resolvedBase as UserConfig, {
    build: {
      outDir: "dist-runtime-perf",
      rollupOptions: {
        input: {
          app: path.resolve(__dirname, "index.html"),
          atlasCorpus: path.resolve(
            __dirname,
            "perf/atlas-corpus-harness.html",
          ),
        },
      },
    },
  });
});
