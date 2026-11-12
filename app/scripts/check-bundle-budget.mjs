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

function requireSingleLazyChunk(label, pattern) {
  const chunks = assets.filter((name) => pattern.test(name));
  if (chunks.length !== 1) {
    throw new Error(`Expected one lazy ${label} chunk, found ${chunks.length}.`);
  }
}

requireSingleLazyChunk("Replay", /^replay-page-.*\.js$/);
requireSingleLazyChunk("route-detail", /^route-detail-page-.*\.js$/);
requireSingleLazyChunk("Overland", /^overland-lab-page-.*\.js$/);

// The Overland lab loads on demand, and stays small: its pixel engine, font
// and world mask never reach the initial shell. Rollup may split the lab
// into a page chunk and shared chunks, so the cap covers every Overland
// chunk together. The 3D realm is a chunk of its own, loaded on entering.
requireSingleLazyChunk("Overland realm", /^overland-realm-.*\.js$/);
const overlandChunks = assets.filter((name) => /^overland-.*\.js$/.test(name));
let overlandBytes = 0;
for (const name of overlandChunks) overlandBytes += (await stat(path.join(dist, "assets", name))).size;
const overlandBudgetBytes = 150 * 1024;
if (overlandBytes > overlandBudgetBytes) {
  throw new Error(
    `Overland chunks are ${(overlandBytes / 1024).toFixed(1)} KiB; budget is ${overlandBudgetBytes / 1024} KiB.`,
  );
}
if (entry.includes("overland-world-mask")) {
  throw new Error("Initial shell unexpectedly contains the Overland world mask.");
}

console.log(
  `Bundle budget passed: initial shell ${(entryBytes / 1024).toFixed(1)} KiB; Replay and route detail remain lazy; Overland is ${(overlandBytes / 1024).toFixed(1)} KiB in ${overlandChunks.length} chunks.`,
);
