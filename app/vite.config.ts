import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

const cesiumBuild = "node_modules/cesium/Build/Cesium";
const cesiumBaseUrl = "/cesiumStatic";

function buildIdentity() {
  const configuredCommit = (
    process.env.GODIESEL_BUILD_COMMIT || process.env.CF_PAGES_COMMIT_SHA
  )?.trim();
  const commit =
    configuredCommit ||
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: path.resolve(__dirname, ".."),
      encoding: "utf8",
    }).trim();
  if (!/^[a-f0-9]{40}$/.test(commit)) {
    throw new Error("goDiesel build identity requires a full Git commit SHA.");
  }
  return {
    schema_version: 1,
    document_type: "godiesel-build-identity",
    commit,
  } as const;
}

function buildIdentityPlugin(): Plugin {
  const identity = JSON.stringify(buildIdentity());
  return {
    name: "godiesel-build-identity",
    configureServer(server) {
      server.middlewares.use("/build-identity.json", (_request, response) => {
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.setHeader("Cache-Control", "no-store");
        response.end(identity);
      });
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "build-identity.json",
        source: identity,
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname, ".."), "");
  const liveProvidersDisabled =
    process.env.GODIESEL_DISABLE_LIVE_PROVIDERS === "1";
  const googleMapsApiKey = liveProvidersDisabled
    ? ""
    : env.VITE_GOOGLE_MAPS_API_KEY ||
      env.GOOGLE_MAPS_API_KEY ||
      process.env.VITE_GOOGLE_MAPS_API_KEY ||
      process.env.GOOGLE_MAPS_API_KEY ||
      "";
  const singleRouteSlug =
    env.VITE_SINGLE_ROUTE_SLUG || process.env.VITE_SINGLE_ROUTE_SLUG || "";
  const routeManifestPath = path.resolve(
    __dirname,
    "src/data/generated/routes.manifest.json",
  );
  const virtualRouteManifestId = "\0godiesel-single-route-manifest";

  return {
    plugins: [
      buildIdentityPlugin(),
      {
        name: "godiesel-single-route-manifest",
        enforce: "pre" as const,
        resolveId(source: string) {
          if (
            singleRouteSlug &&
            (source === "@/data/generated/routes.manifest.json" ||
              source.endsWith("/data/generated/routes.manifest.json"))
          ) {
            return virtualRouteManifestId;
          }
        },
        load(id: string) {
          if (id !== virtualRouteManifestId) return;
          const manifest = JSON.parse(
            fs.readFileSync(routeManifestPath, "utf8"),
          ) as {
            routes?: Array<{ slug?: string }>;
          };
          const routes = (manifest.routes ?? []).filter(
            (route) => route.slug === singleRouteSlug,
          );
          if (routes.length !== 1) {
            throw new Error(
              `Single-route microsite slug ${singleRouteSlug} was not found exactly once.`,
            );
          }
          return `export default ${JSON.stringify({ ...manifest, routes })};`;
        },
      },
      react(),
      tailwindcss(),
      viteStaticCopy({
        targets: [
          ...["Workers", "Assets", "Widgets", "ThirdParty"].map(
            (directory) => ({
              src: `${cesiumBuild}/${directory}/**/*`,
              dest: `cesiumStatic/${directory}`,
              rename: { stripBase: 5 },
            }),
          ),
        ],
      }),
    ],
    define: {
      CESIUM_BASE_URL: JSON.stringify(cesiumBaseUrl),
      "import.meta.env.VITE_GOOGLE_MAPS_API_KEY":
        JSON.stringify(googleMapsApiKey),
      "import.meta.env.VITE_SINGLE_ROUTE_SLUG": JSON.stringify(singleRouteSlug),
    },
    server: {
      port: 8787,
    },
    build: {
      target: "esnext",
      // Replay is lazy-loaded and owns the bundled Cesium runtime. Keep that
      // expected 5.5 MB scene chunk explicit while the initial shell remains
      // below 500 kB and other product routes stay independently split.
      chunkSizeWarningLimit: 5_600,
    },
    resolve: {
      alias: [
        {
          find: "@/app/app-shell",
          replacement: path.resolve(
            __dirname,
            singleRouteSlug
              ? "./src/app/app-shell.single.tsx"
              : "./src/app/app-shell.tsx",
          ),
        },
        {
          find: "@/app/router",
          replacement: path.resolve(
            __dirname,
            singleRouteSlug
              ? "./src/app/router.single.tsx"
              : "./src/app/router.tsx",
          ),
        },
        { find: "@", replacement: path.resolve(__dirname, "./src") },
      ],
    },
  };
});
