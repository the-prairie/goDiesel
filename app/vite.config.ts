import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig, loadEnv } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

const cesiumBuild = "node_modules/cesium/Build/Cesium";
const cesiumBaseUrl = "/cesiumStatic";
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname, ".."), "");
  const googleMapsApiKey =
    env.VITE_GOOGLE_MAPS_API_KEY || env.GOOGLE_MAPS_API_KEY || "";

  return {
    plugins: [
      react(),
      tailwindcss(),
      viteStaticCopy({
        targets: [
          ...["Workers", "Assets", "Widgets", "ThirdParty"].map((directory) => ({
            src: `${cesiumBuild}/${directory}/**/*`,
            dest: `cesiumStatic/${directory}`,
            rename: { stripBase: 5 },
          })),
        ],
      }),
    ],
    define: {
      CESIUM_BASE_URL: JSON.stringify(cesiumBaseUrl),
      "import.meta.env.VITE_GOOGLE_MAPS_API_KEY": JSON.stringify(googleMapsApiKey),
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
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
