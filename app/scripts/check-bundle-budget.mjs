import { bucketChunks, overBudget } from "./sketch-budgets.mjs";
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
// 2026-11-14: 88 KiB for the drawn buildings' roof heights (sketch-roof-tops:
// each building's box and drawn top, sent with its tile), so a moment's marker
// stands on the roof that is drawn; 87.0 KiB used.
// 2026-11-14: 93 KiB for every place she has run (round 14); 91.6 KiB used.
// Then (round 14, approved) one total became budgets by when each chunk
// loads: see sketch-budgets.mjs. Only what every visit loads at opening is
// held to the hard budget (84 KiB).
if (entry.includes("sketch-edge-worker") || entry.includes("building-edges")) {
  throw new Error("Initial shell unexpectedly contains the sketch world.");
}
const lab = bucketChunks(assets);
if (lab.unassigned.length) throw new Error(`Lab chunks in no budget (add them to sketch-budgets.mjs): ${lab.unassigned.join(", ")}`);
if (lab.ambiguous.length) throw new Error(`Lab chunks in more than one budget: ${lab.ambiguous.join(", ")}`);
for (const id of ["sketch-opening", "moments-world", "moment-scene"]) if (!lab.buckets.get(id)?.length) throw new Error(`The ${id} chunks are missing from the build.`);
const labSizes = new Map();
for (const names of lab.buckets.values()) for (const name of names) labSizes.set(name, (await stat(path.join(dist, "assets", name))).size);
const labOver = overBudget(lab.buckets, (name) => labSizes.get(name));
if (labOver.length) throw new Error(labOver.map((over) => `${over.label} is ${(over.bytes / 1024).toFixed(1)} KiB; budget is ${over.kib} KiB.`).join(" "));
const labKiB = (id) => ((lab.buckets.get(id) ?? []).reduce((sum, name) => sum + labSizes.get(name), 0) / 1024).toFixed(1);
console.log(
  `Bundle budget passed: initial shell ${(entryBytes / 1024).toFixed(1)} KiB; Replay and route detail remain lazy; Overland is ${(overlandBytes / 1024).toFixed(1)} KiB in ${overlandChunks.length} chunks; the town renderer is ${(townRendererBytes / 1024).toFixed(1)} KiB; the sketch world at opening ${labKiB("sketch-opening")} KiB (real-city view ${labKiB("sketch-real-view")}, ink hand-over page ${labKiB("sketch-real-page")}); planted moments with the world ${labKiB("moments-world")} KiB, review mode ${labKiB("moment-review")}, catalog page ${labKiB("moments-catalog-page")}, each scene within 8 KiB.`,
);
