import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

// The Routes library and Finder must render their own content without waiting
// for MapLibre or the route-cover artwork manifest. Both may be loaded on
// demand, but neither may sit in the static import graph of those page chunks.
const assetsDirectory = path.resolve("dist", "assets");
const assets = await readdir(assetsDirectory);
const forbidden = [
  { label: "MapLibre", marker: "maplibregl-map" },
  { label: "the route-cover artwork manifest", marker: "artworkSha256" },
];

async function staticClosure(chunk) {
  const seen = new Set();
  const pending = [chunk];
  while (pending.length) {
    const name = pending.pop();
    if (seen.has(name)) continue;
    seen.add(name);
    const source = await readFile(path.join(assetsDirectory, name), "utf8");
    // Static imports only: `import{..}from"./x.js"` and `import"./x.js"`.
    // Dynamic `import("./x.js")` is deliberately not followed.
    for (const match of source.matchAll(/(?:\bfrom|\bimport)\s*"\.\/([^"]+\.js)"/g)) {
      pending.push(match[1]);
    }
  }
  return seen;
}

// A single-route microsite build (ADR-0011) never emits these surfaces.
const singleRoute = Boolean(process.env.GODIESEL_SINGLE_ROUTE_SLUG || process.env.VITE_SINGLE_ROUTE_SLUG);

for (const [label, pattern] of [
  ["Routes library", /^routes-page-.*\.js$/],
  ["Finder", /^finder-page-.*\.js$/],
]) {
  const chunks = assets.filter((name) => pattern.test(name));
  if (singleRoute && chunks.length === 0) continue;
  if (chunks.length !== 1) {
    throw new Error(`Expected one lazy ${label} chunk, found ${chunks.length}.`);
  }
  for (const name of await staticClosure(chunks[0])) {
    const source = await readFile(path.join(assetsDirectory, name), "utf8");
    for (const { label: dependency, marker } of forbidden) {
      if (source.includes(marker)) {
        throw new Error(
          `${label} chunk statically imports ${dependency} (via ${name}); load it on demand instead.`,
        );
      }
    }
  }
}

console.log("Lazy page data passed: Routes library and Finder load MapLibre and cover artwork on demand.");
