#!/usr/bin/env node
// Her planted moments in a build. Her catalog, placements and clips live in
// the gitignored public/moments/ folder, which Vite copies whole into the
// build. make-dist.sh runs this on dist/ afterwards: it rebuilds
// dist/moments/ with only the entries she flagged public, their placements
// and their clips. Everything else stays out. A public entry whose clip is not
// on this machine ships with no clip and shows "no signal".
//
//   node app/scripts/moments-dist.mjs <source moments dir> <dist dir>

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The clip's file name inside the moments folder, or null for anything else. */
function clipFile(clip) {
  const match = typeof clip === "string" ? /^\/moments\/([\w-]+\.(?:mp4|webm))$/.exec(clip) : null;
  return match ? match[1] : null;
}

/** What a build ships: public entries, their placements, their clips (those present). */
export function publicMoments(data, exists) {
  if (!data || !Array.isArray(data.catalog) || !Array.isArray(data.placements)) return { moments: null, clips: [] };
  const clips = [];
  const catalog = data.catalog
    .filter((entry) => entry.public === true)
    .map((entry) => {
      const file = clipFile(entry.clip);
      if (file && exists(file)) {
        clips.push(file);
        return entry;
      }
      return { ...entry, clip: null };
    });
  const ids = new Set(catalog.map((entry) => entry.id));
  const placements = data.placements.filter((placement) => placement.entryId !== null && ids.has(placement.entryId));
  return { moments: { catalog, placements }, clips };
}

function main([source, dist]) {
  const out = path.join(dist, "moments");
  rmSync(out, { recursive: true, force: true });
  const file = path.join(source, "moments.json");
  if (!existsSync(file)) {
    console.log("Moments: no private catalog; the example ships.");
    return;
  }
  const { moments, clips } = publicMoments(JSON.parse(readFileSync(file, "utf8")), (name) => existsSync(path.join(source, name)));
  if (!moments || moments.catalog.length === 0) {
    console.log("Moments: nothing flagged public; none ship.");
    return;
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, "moments.json"), JSON.stringify(moments, null, 2));
  for (const clip of clips) copyFileSync(path.join(source, clip), path.join(out, clip));
  console.log(`Moments: ${moments.catalog.length} public entr${moments.catalog.length === 1 ? "y" : "ies"}, ${clips.length} clip(s), ${moments.placements.length} placement(s).`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main(process.argv.slice(2));
