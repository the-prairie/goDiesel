#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const [routeSlug, mode = "source", stageDirectory] = process.argv.slice(2);
const root = path.resolve(import.meta.dirname, "..");

function fail(message) {
  console.error(`Route microsite validation failed: ${message}`);
  process.exit(1);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(`${path.basename(filePath)} is not valid JSON (${error.name})`);
  }
}

function validateRoute(route, expectedSlug) {
  if (!route || typeof route !== "object" || Array.isArray(route)) {
    fail("route must be an object");
  }
  if (route.slug !== expectedSlug) fail(`route slug must equal ${expectedSlug}`);

  for (const field of ["name", "region", "type"]) {
    if (typeof route[field] !== "string" || !route[field].trim()) {
      fail(`${field} is required`);
    }
  }

  // A published page must say something about the route. Either the recorded
  // activity description or the owner's curated vibe satisfies that. They are
  // different fields with different provenance — the activity's own words
  // versus the editorial premise — so neither is copied into the other.
  // Copying produced a page that printed the same sentence twice.
  const hasWords = [route.description, route.curation?.vibe].some(
    (value) => typeof value === "string" && value.trim(),
  );
  if (!hasWords) {
    fail("a published route needs an activity description or a curated vibe");
  }

  if (
    ![route.subtitle, route.activity_name].some(
      (value) => typeof value === "string" && value.trim(),
    )
  ) {
    fail("subtitle or activity_name is required for the public route title");
  }
  // A discovered route may have no recorded date; the generator writes "".
  // Every other date must be a real calendar day.
  if (route.date === "") {
    if (route.lifecycle !== "discovered") {
      fail("date is required; only a discovered route may have an unavailable date");
    }
  } else {
    const date = new Date(`${route.date}T00:00:00Z`);
    if (
      typeof route.date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(route.date) ||
      Number.isNaN(date.valueOf()) ||
      date.toISOString().slice(0, 10) !== route.date
    ) {
      fail("date must use a valid YYYY-MM-DD value");
    }
  }
  if (!Number.isFinite(route.distance_km) || route.distance_km <= 0) {
    fail("distance_km must be a positive number");
  }

  // Honest elevation, as the app's strict detail parser reads it
  // (app/src/domain/route/detail-parse.ts): an absent status means recorded;
  // an unavailable route has a null gain and may have null point elevations; a
  // recorded route has a finite, non-negative gain and finite elevations.
  const elevationStatus = route.elevation_status ?? "recorded";
  if (elevationStatus !== "recorded" && elevationStatus !== "unavailable") {
    fail("elevation_status must be recorded or unavailable");
  }
  const elevationRecorded = elevationStatus === "recorded";
  if (
    elevationRecorded
      ? !Number.isFinite(route.elevation_gain_m) || route.elevation_gain_m < 0
      : route.elevation_gain_m !== null
  ) {
    fail(
      elevationRecorded
        ? "elevation_gain_m must be a non-negative number when elevation is recorded"
        : "elevation_gain_m must be null when elevation_status is unavailable",
    );
  }
  if (!Array.isArray(route.route) || route.route.length < 2) {
    fail("route geometry must contain at least two points");
  }

  let previousDistance = -Infinity;
  let previousElapsed = -Infinity;
  for (const [index, point] of route.route.entries()) {
    if (!point || typeof point !== "object" || Array.isArray(point)) {
      fail(`route point ${index} must be an object`);
    }
    const elevationValid =
      Number.isFinite(point.elev) || (!elevationRecorded && point.elev === null);
    if (![point.lat, point.lng, point.d].every(Number.isFinite) || !elevationValid) {
      fail(
        elevationRecorded
          ? `route point ${index} must contain finite lat, lng, elev, and d values`
          : `route point ${index} must contain finite lat, lng, and d values and a finite or null elev`,
      );
    }
    if (point.lat < -90 || point.lat > 90) {
      fail(`route point ${index} latitude is outside -90 to 90`);
    }
    if (point.lng < -180 || point.lng > 180) {
      fail(`route point ${index} longitude is outside -180 to 180`);
    }
    if (point.d < 0) {
      fail(`route point ${index} distance must be non-negative`);
    }
    if (point.d < previousDistance) {
      fail(`route distance decreases at point ${index}`);
    }
    if (
      point.elapsed_s !== undefined &&
      (!Number.isFinite(point.elapsed_s) ||
        point.elapsed_s < 0 ||
        point.elapsed_s < previousElapsed)
    ) {
      fail(`route elapsed time is invalid at point ${index}`);
    }
    previousDistance = point.d;
    if (point.elapsed_s !== undefined) previousElapsed = point.elapsed_s;
  }
  if (previousDistance <= 0) {
    fail("route geometry must cover a positive distance");
  }
  const declaredDistanceM = route.distance_km * 1_000;
  const distanceDifferenceRatio =
    Math.abs(previousDistance - declaredDistanceM) / declaredDistanceM;
  if (distanceDifferenceRatio > 0.02) {
    fail("distance_km must agree with route geometry within 2 percent");
  }

  if (
    !Number.isFinite(route.center_lat) ||
    route.center_lat < -90 ||
    route.center_lat > 90 ||
    !Number.isFinite(route.center_lng) ||
    route.center_lng < -180 ||
    route.center_lng > 180
  ) {
    fail("route center must contain valid latitude and longitude values");
  }
  if (
    !Number.isInteger(route.mid_idx) ||
    route.mid_idx < 0 ||
    route.mid_idx >= route.route.length
  ) {
    fail("mid_idx must identify a route geometry point");
  }

  if (route.replay?.replay_eligible !== true) {
    fail("replay.replay_eligible must be true");
  }
  if (route.replay?.geometry_status !== "ready") {
    fail("replay.geometry_status must be ready");
  }
  if (route.replay?.mode !== "atlas" && route.replay?.mode !== "earth") {
    fail("replay.mode must be atlas or earth");
  }
  if (route.replay?.point_count !== route.route.length) {
    fail("replay.point_count must match route geometry");
  }
}

function listFiles(directory, prefix = "") {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.posix.join(prefix, entry.name);
    return entry.isDirectory()
      ? listFiles(path.join(directory, entry.name), relativePath)
      : [relativePath];
  });
}

function collectMediaReferences(value, references = new Set()) {
  if (typeof value === "string" && value.startsWith("media/")) {
    references.add(value);
    return references;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectMediaReferences(item, references);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectMediaReferences(item, references);
  }
  return references;
}

// Every route identifier the owner's atlas knows about: authored activity ids
// and every generated route detail. A share must not name any of them except
// its own, in a file path or in any served text.
function otherRouteIdentifiers(sharedSlug) {
  const identifiers = new Set();
  const config = readJson(path.join(root, "quests.json"));
  for (const route of config.routes ?? []) {
    if (route?.activity_id !== undefined) identifiers.add(String(route.activity_id));
  }
  for (const file of listFiles(path.join(root, "app/public/data/routes"))) {
    if (file.endsWith(".json")) identifiers.add(path.posix.basename(file, ".json"));
  }
  identifiers.delete(sharedSlug);
  identifiers.delete("");
  return identifiers;
}

// Product surfaces and labs that a share's route table never mounts. Their
// chunk names come from the lazy page modules in app/src/app/router.tsx.
const FORBIDDEN_PRODUCT_CHUNKS = [
  "admin-page",
  "atlas-page",
  "finder-page",
  "routes-page",
  "course-page",
  "course-preview-page",
  "playable-earth-lab-page",
  "design-system-lab-page",
  "route-intelligence-lab-page",
  "google-route-navigator-lab-page",
  "cinematic-route-trailer-lab-page",
  "cinematic-director-lab-page",
];

const TEXT_FILE = /\.(?:css|html|js|json|mjs|svg|txt|webmanifest|xml)$|(?:^|\/)_(?:headers|redirects)$/;

function validateDist(distRoot) {
  const failures = [];
  const dataDir = path.join(distRoot, "data");
  const expectedRoutePath = `routes/${routeSlug}.json`;
  const dataFiles = listFiles(dataDir).sort();
  if (dataFiles.length !== 1 || dataFiles[0] !== expectedRoutePath) {
    fail(`built bundle data must contain only ${expectedRoutePath}`);
  }
  const builtRoute = readJson(path.join(dataDir, expectedRoutePath));
  validateRoute(builtRoute, routeSlug);

  // Pages Functions and advanced-mode workers would publish server code (and
  // its bindings) on the share's hostname. A share is static files only.
  for (const serverEntry of ["functions", "_worker.js", "_routes.json"]) {
    if (fs.existsSync(path.join(distRoot, serverEntry))) {
      failures.push(`built bundle must not contain server code (${serverEntry})`);
    }
  }

  const expectedMedia = [...collectMediaReferences(builtRoute)].sort();
  for (const reference of expectedMedia) {
    if (
      path.posix.normalize(reference) !== reference ||
      !reference.startsWith(`media/${routeSlug}/`)
    ) {
      failures.push(`route media reference is outside media/${routeSlug}: ${reference}`);
    }
  }
  const builtMedia = listFiles(path.join(distRoot, "media"))
    .map((file) => `media/${file}`)
    .sort();
  if (JSON.stringify(builtMedia) !== JSON.stringify(expectedMedia)) {
    const extra = builtMedia.filter((file) => !expectedMedia.includes(file));
    const missing = expectedMedia.filter((file) => !builtMedia.includes(file));
    failures.push(
      "built bundle media must contain only files referenced by the shared route" +
        ` (${extra.length} unreferenced, ${missing.length} missing; first: ${extra[0] ?? missing[0]})`,
    );
  }

  const assetFiles = listFiles(path.join(distRoot, "assets")).sort();
  const productChunks = assetFiles.filter((file) =>
    FORBIDDEN_PRODUCT_CHUNKS.some((name) => new RegExp(`^${name}-[^/]+$`).test(file)),
  );
  if (productChunks.length > 0) {
    failures.push(
      `built bundle includes ${productChunks.length} unrelated product chunks: ${productChunks.join(", ")}`,
    );
  }

  const others = otherRouteIdentifiers(routeSlug);
  const numericOthers = new Set([...others].filter((id) => /^\d+$/.test(id)));
  const textualOthers = [...others].filter((id) => !numericOthers.has(id));
  const allFiles = listFiles(distRoot).sort();

  const leakedPaths = allFiles.filter((file) =>
    (file.match(/\d+/g) ?? []).some((token) => numericOthers.has(token)) ||
    textualOthers.some((id) => file.includes(id)),
  );
  if (leakedPaths.length > 0) {
    failures.push(
      `built bundle includes ${leakedPaths.length} files named for another route: ` +
        leakedPaths.slice(0, 5).join(", ") +
        (leakedPaths.length > 5 ? ", ..." : ""),
    );
  }

  const leakedText = [];
  for (const file of allFiles.filter((name) => TEXT_FILE.test(name))) {
    const text = fs.readFileSync(path.join(distRoot, file), "utf8");
    const found = new Set();
    for (const token of text.match(/\d{6,}/g) ?? []) {
      if (numericOthers.has(token)) found.add(token);
    }
    for (const id of textualOthers) if (text.includes(id)) found.add(id);
    if (found.size > 0) leakedText.push(`${file} [${[...found].slice(0, 4).join(", ")}${found.size > 4 ? ", ..." : ""}]`);
  }
  if (leakedText.length > 0) {
    failures.push(
      `built files name another route's identifier: ${leakedText.join("; ")}`,
    );
  }

  // Atlas-wide totals (route count, completed distance) describe the whole
  // collection, not the shared route.
  const atlasTotals = assetFiles.filter(
    (file) =>
      /\.(?:js|mjs)$/.test(file) &&
      fs.readFileSync(path.join(distRoot, "assets", file), "utf8").includes("route_count"),
  );
  if (atlasTotals.length > 0) {
    failures.push(`built assets include atlas-wide route totals: ${atlasTotals.join(", ")}`);
  }

  const robots = fs.readFileSync(path.join(distRoot, "robots.txt"), "utf8");
  if (!robots.includes("Disallow: /")) {
    failures.push("single-route bundle must be excluded from search indexing");
  }
  const headers = fs.readFileSync(path.join(distRoot, "_headers"), "utf8");
  if (!/^\/\*\s*\n\s*X-Robots-Tag:\s*[^\n]*\bnoindex\b/im.test(headers)) {
    failures.push("single-route bundle must send a site-wide X-Robots-Tag noindex header");
  }

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`Route microsite validation failed: ${failure}`);
    }
    process.exit(1);
  }
}

if (!routeSlug || !/^[A-Za-z0-9._-]+$/.test(routeSlug)) {
  fail("provide a safe route slug as the first argument");
}
if (!new Set(["source", "dist", "stage"]).has(mode)) {
  fail("mode must be source, dist, or stage");
}

const sourcePath = path.join(root, "app/public/data/routes", `${routeSlug}.json`);
if (!fs.existsSync(sourcePath)) fail(`missing source route ${routeSlug}.json`);
validateRoute(readJson(sourcePath), routeSlug);

if (mode === "dist") {
  validateDist(path.join(root, "dist"));
}

if (mode === "stage") {
  // The directory `wrangler pages deploy dist` runs in. Wrangler compiles a
  // `functions/` directory beside the output and reads `wrangler.toml` from
  // its working directory, so the repository root would publish the course
  // and discovery APIs (and their bindings) on the share's hostname. The
  // stage must hold the scoped output and nothing else.
  if (!stageDirectory) fail("stage mode requires the staging directory");
  const stageRoot = path.resolve(stageDirectory);
  if (stageRoot === root || !fs.existsSync(stageRoot)) {
    fail("the staging directory must exist outside the repository root");
  }
  const entries = fs.readdirSync(stageRoot).sort();
  if (JSON.stringify(entries) !== JSON.stringify(["dist"])) {
    fail(`the staging directory must contain only dist (found ${entries.join(", ") || "nothing"})`);
  }
  validateDist(path.join(stageRoot, "dist"));
}

console.log(`Validated ${routeSlug} (${mode}).`);
