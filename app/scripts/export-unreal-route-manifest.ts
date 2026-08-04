import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { parseRouteDetail } from "../src/domain/routes";
import {
  createPortableRouteFilmManifest,
  type RouteFilmManifestOptions,
} from "../src/replay/film/portable-route-film-manifest";

function argument(name: string, fallback: string) {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

const route = argument("route", "14023448720");
const output = resolve(
  argument(
    "output",
    `../unreal/RouteFilmProof/Manifests/${route}-feature.json`,
  ),
);
const routePath = resolve(`public/data/routes/${route}.json`);
const options: RouteFilmManifestOptions = {
  cut: argument("cut", "feature") as RouteFilmManifestOptions["cut"],
  durationSeconds: Number(argument("duration", "24")),
  fps: Number(argument("fps", "24")),
  width: Number(argument("width", "3840")),
  height: Number(argument("height", "2160")),
};

const source = JSON.parse(await readFile(routePath, "utf8")) as unknown;
const parsedRoute = parseRouteDetail(source);
const manifest = createPortableRouteFilmManifest(parsedRoute, options);

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(
  JSON.stringify(
    {
      cameraKeyframes: manifest.camera.keyframes.length,
      durationSeconds: manifest.render.durationSeconds,
      frameCount: manifest.render.frameCount,
      output,
      route: manifest.route.slug,
    },
    null,
    2,
  ),
);
