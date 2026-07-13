import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 8787,
  },
  build: {
    target: "esnext",
    // Atlas is lazy-loaded and carries the Three.js runtime. Keep its
    // minified budget explicit while the initial shell stays below 500 kB.
    chunkSizeWarningLimit: 600,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
