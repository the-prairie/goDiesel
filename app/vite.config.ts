import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

const cesiumBuild = "node_modules/cesium/Build/Cesium";
const cesiumBaseUrl = "/cesiumStatic";
const replayAvatarDirectory = path.resolve(__dirname, "../route-avatars");

function replayAvatarAssets(): Plugin {
  return {
    name: "godiesel-replay-avatar-assets",
    configureServer(server) {
      server.middlewares.use("/route-avatars/", (request, response, next) => {
        const filename = path.basename(request.url?.split("?")[0] ?? "");
        if (!/^[a-z0-9-]+\.lottie$/.test(filename)) {
          next();
          return;
        }
        const assetPath = path.join(replayAvatarDirectory, filename);
        if (!existsSync(assetPath)) {
          next();
          return;
        }
        response.setHeader("Content-Type", "application/zip");
        createReadStream(assetPath).pipe(response);
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname, ".."), "");
  const googleMapsApiKey =
    env.VITE_GOOGLE_MAPS_API_KEY || env.GOOGLE_MAPS_API_KEY || "";

  return {
    plugins: [
      react(),
      tailwindcss(),
      replayAvatarAssets(),
      viteStaticCopy({
        targets: [
          ...["Workers", "Assets", "Widgets", "ThirdParty"].map((directory) => ({
            src: `${cesiumBuild}/${directory}/**/*`,
            dest: `cesiumStatic/${directory}`,
            rename: { stripBase: 5 },
          })),
          {
            src: "../route-avatars/*.lottie",
            dest: "route-avatars",
          },
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
      // expected 4.5 MB scene chunk explicit while the initial shell remains
      // below 500 kB and other product routes stay independently split.
      chunkSizeWarningLimit: 4_500,
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
