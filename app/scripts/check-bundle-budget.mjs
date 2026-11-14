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
// The 3D town renderer and three.js load only when a town opens. Its cap is
// set from the measured size (584 KiB with three 0.186.1) plus a little room.
requireSingleLazyChunk("Overland town renderer", /^town-renderer-.*\.js$/);
const townRenderer = assets.find((name) => /^town-renderer-.*\.js$/.test(name));
const townRendererBytes = (await stat(path.join(dist, "assets", townRenderer))).size;
const townRendererBudgetBytes = 600 * 1024;
if (townRendererBytes > townRendererBudgetBytes) {
  throw new Error(
    `The Overland town renderer is ${(townRendererBytes / 1024).toFixed(1)} KiB; budget is ${townRendererBudgetBytes / 1024} KiB.`,
  );
}
for (const forbidden of ["MeshToonMaterial", "PCFShadowMap"]) {
  if (entry.includes(forbidden)) {
    throw new Error(`Initial shell unexpectedly contains three.js: ${forbidden}.`);
  }
}
// The town's model chunks (shared by the lab page and the renderer) are
// Overland code too, and count against the Overland cap.
const overlandChunks = assets.filter((name) => /^(overland-|town-).*\.js$/.test(name) && name !== townRenderer);
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

// The sketch world (lab): its page and its edge worker, lazy, on top of the
// MapLibre chunk the app already loads on demand. Measured at 39.5 KiB when
// added; 54.3 KiB once it drew its buildings by rule (page 38.3 KiB, worker
// 14.2 KiB, the sketch-real spike's page 1.8 KiB, which shares Cesium's
// chunk); 69.7 KiB with the hand-over to the real city (page 43.6 KiB,
// worker 14.2, the real view 6.9, the spike page 3.7, shared reveal 1.3).
// Cesium itself stays in its own lazy chunk, shared with Atlas, loaded only
// when the hand-over starts. The cap leaves a little room.
// 2026-11-14: raised from 76 to 86 KiB for the regional building rules
// (round 10: regions, forms, land-use types, landmarks, regional facades and
// the grey and colour split), measured at 85.8 KiB (page 52.4, worker 20.4).
// 2026-11-14: 87 KiB for planted moments' hook in the world (86.4 KiB used);
// the moments themselves load in their own chunks, budgeted below.
const sketchChunks = assets.filter((name) => /^sketch-.*\.js$/.test(name));
let sketchBytes = 0;
for (const name of sketchChunks) sketchBytes += (await stat(path.join(dist, "assets", name))).size;
const sketchBudgetBytes = 87 * 1024;
if (sketchChunks.length === 0) throw new Error("The sketch world's chunks are missing from the build.");
if (sketchBytes > sketchBudgetBytes) {
  throw new Error(`The sketch world is ${(sketchBytes / 1024).toFixed(1)} KiB; budget is ${sketchBudgetBytes / 1024} KiB.`);
}
if (entry.includes("sketch-edge-worker") || entry.includes("building-edges")) {
  throw new Error("Initial shell unexpectedly contains the sketch world.");
}

// Planted moments (lab): the layer that places them and each kind's scene,
// loaded only once the map is up and a moment is opened. 10.9 KiB when added
// (2026-11-14, the tv-wall scene). Her catalog view is its own page chunk.
const momentChunks = assets.filter((name) => /^moment-.*\.js$/.test(name));
let momentBytes = 0;
for (const name of momentChunks) momentBytes += (await stat(path.join(dist, "assets", name))).size;
if (momentBytes > 12 * 1024) throw new Error(`Planted moments are ${(momentBytes / 1024).toFixed(1)} KiB; budget is 12 KiB.`);
const catalogChunks = assets.filter((name) => /^moments-catalog-page-.*\.js$/.test(name));
let catalogBytes = 0;
for (const name of catalogChunks) catalogBytes += (await stat(path.join(dist, "assets", name))).size;
if (catalogBytes > 6 * 1024) throw new Error(`The moments catalog page is ${(catalogBytes / 1024).toFixed(1)} KiB; budget is 6 KiB.`);
console.log(
  `Bundle budget passed: initial shell ${(entryBytes / 1024).toFixed(1)} KiB; Replay and route detail remain lazy; Overland is ${(overlandBytes / 1024).toFixed(1)} KiB in ${overlandChunks.length} chunks; the town renderer is ${(townRendererBytes / 1024).toFixed(1)} KiB; the sketch world is ${(sketchBytes / 1024).toFixed(1)} KiB in ${sketchChunks.length} chunks; planted moments ${(momentBytes / 1024).toFixed(1)} KiB, their catalog ${(catalogBytes / 1024).toFixed(1)} KiB.`,
);
