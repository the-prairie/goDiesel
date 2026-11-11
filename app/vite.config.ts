import { discoveryPlugin } from "./server/discovery-plugin";
import { coursesPlugin } from "./server/courses-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { defineConfig, loadEnv } from "vite";

const cesiumBaseUrl = "/cesiumStatic";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname, ".."), "");
  const liveProvidersDisabled = process.env.GODIESEL_DISABLE_LIVE_PROVIDERS === "1";
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
  const routeCoverManifestPath = path.resolve(__dirname, "src/data/route-covers/manifest.json");
  const virtualRouteCoverManifestId = "\0godiesel-single-route-covers";
  const virtualOmittedRouteDataId = "\0godiesel-single-route-omitted";

  return {
    plugins: [
      coursesPlugin({ token: env.GODIESEL_COURSE_TOKEN, routerUrl: env.GODIESEL_ROUTER_URL, signingKey: env.GODIESEL_COURSE_SIGNING_KEY, orsApiKey: env.ORS_API_KEY, nextgisOverpassKey: env.NEXTGIS_OVERPASS_API_KEY }),
      discoveryPlugin(),
      {
        name: "godiesel-single-route-manifest",
        enforce: "pre" as const,
        resolveId(source: string) {
          if (!singleRouteSlug) return;
          if (
            source === "@/data/generated/routes.manifest.json" ||
            source.endsWith("/data/generated/routes.manifest.json")
          ) {
            return virtualRouteManifestId;
          }
          if (source.endsWith("/data/route-covers/manifest.json")) {
            return virtualRouteCoverManifestId;
          }
          // Per-route data modules (reviewed replay stories) are named by
          // route. Another route's module resolves to nothing at all.
          const perRoute = source.match(/\/data\/replay-stories\/([^/]+)\.json$/);
          if (perRoute && perRoute[1] !== singleRouteSlug) {
            return virtualOmittedRouteDataId;
          }
        },
        writeBundle(options: { dir?: string }) {
          if (!singleRouteSlug) return;
          const indexPath = path.join(options.dir ?? path.resolve(__dirname, "dist"), "search/collection.json");
          const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
          index.documents = index.documents.filter((doc: { slug: string }) => doc.slug === singleRouteSlug);
          fs.writeFileSync(indexPath, JSON.stringify(index));
        },
        load(id: string) {
          if (id === virtualOmittedRouteDataId) return "export default null;";
          if (id === virtualRouteCoverManifestId) {
            const covers = JSON.parse(fs.readFileSync(routeCoverManifestPath, "utf8")) as Record<string, unknown>;
            const scoped = singleRouteSlug in covers ? { [singleRouteSlug]: covers[singleRouteSlug] } : {};
            return `export default ${JSON.stringify(scoped)};`;
          }
          if (id !== virtualRouteManifestId) return;
          const manifest = JSON.parse(fs.readFileSync(routeManifestPath, "utf8")) as {
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
    ],
    define: {
      CESIUM_BASE_URL: JSON.stringify(cesiumBaseUrl),
      "import.meta.env.VITE_GOOGLE_MAPS_API_KEY": JSON.stringify(googleMapsApiKey),
      "import.meta.env.VITE_SINGLE_ROUTE_SLUG": JSON.stringify(singleRouteSlug),
    },
    worker: { format: "es" },
    server: {
      port: 8787,
      // admin.sh and scripts/verify-live-pipeline.sh probe this fixed port. A
      // busy port must fail the start, not move the app to the next port.
      strictPort: true,
    },
    build: {
      target: "esnext",
      // Replay is lazy-loaded and owns the bundled Cesium runtime. Keep that
      // expected 5.5 MB scene chunk explicit while the initial shell remains
      // below 500 kB and other product routes stay independently split.
      chunkSizeWarningLimit: 5_600,
    },
    resolve: {
      // A single-route build swaps in a route table and shell that never
      // import the product surfaces, so their chunks are not emitted at all.
      alias: [
        ...(singleRouteSlug
          ? [
              { find: "@/app/router", replacement: path.resolve(__dirname, "./src/app/router.single.tsx") },
              { find: "@/app/app-shell", replacement: path.resolve(__dirname, "./src/app/app-shell.single.tsx") },
            ]
          : []),
        { find: "@", replacement: path.resolve(__dirname, "./src") },
      ],
    },
  };
});
