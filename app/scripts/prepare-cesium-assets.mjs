import { cpSync, mkdirSync, rmSync } from "node:fs";

const source = new URL("../node_modules/cesium/Build/Cesium/", import.meta.url);
const destination = new URL("../public/cesiumStatic/", import.meta.url);

// These generated assets are served by Vite in dev and copied into dist at build.
rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });
for (const directory of ["Workers", "Assets", "Widgets", "ThirdParty"]) {
  cpSync(new URL(directory, source), new URL(directory, destination), {
    recursive: true,
  });
}
