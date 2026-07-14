import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const dist = path.resolve("dist");
const html = await readFile(path.join(dist, "index.html"), "utf8");
const entrySources = [...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map(
  (match) => match[1],
);

if (entrySources.length !== 1) {
  throw new Error(`Expected one initial JavaScript entry, found ${entrySources.length}.`);
}

const entryPath = path.join(dist, entrySources[0].replace(/^\//, ""));
const entry = await readFile(entryPath, "utf8");
const entryBytes = (await stat(entryPath)).size;
const entryBudgetBytes = 500 * 1024;

if (entryBytes > entryBudgetBytes) {
  throw new Error(
    `Initial shell is ${(entryBytes / 1024).toFixed(1)} KiB; budget is ${entryBudgetBytes / 1024} KiB.`,
  );
}

for (const forbidden of ["CesiumWidget", "createGooglePhotorealistic3DTileset"]) {
  if (entry.includes(forbidden)) {
    throw new Error(`Initial shell unexpectedly contains Replay runtime marker: ${forbidden}.`);
  }
}

const assets = await readdir(path.join(dist, "assets"));
const replayChunks = assets.filter((name) => /^replay-page-.*\.js$/.test(name));
const routeDetailChunks = assets.filter((name) => /^route-detail-page-.*\.js$/.test(name));

if (replayChunks.length !== 1) {
  throw new Error(`Expected one lazy Replay chunk, found ${replayChunks.length}.`);
}
if (routeDetailChunks.length !== 1) {
  throw new Error(`Expected one lazy route-detail chunk, found ${routeDetailChunks.length}.`);
}

console.log(
  `Bundle budget passed: initial shell ${(entryBytes / 1024).toFixed(1)} KiB; Replay and route detail remain lazy.`,
);
