#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const [routeSlug, mode = "source"] = process.argv.slice(2);
const root = path.resolve(import.meta.dirname, "..");

function fail(message) {
  console.error(`Route microsite validation failed: ${message}`);
  process.exit(1);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(`${filePath} is not valid JSON (${error.message})`);
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
  if (route.date !== "") {
    const date = new Date(`${route.date}T00:00:00Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(route.date) ||
      Number.isNaN(date.valueOf()) ||
      date.toISOString().slice(0, 10) !== route.date
    ) {
      fail("date must use a valid YYYY-MM-DD value");
    }
  } else if (route.lifecycle !== "discovered") {
    fail("only a discovered route may have an unavailable date");
  }
  if (!Number.isFinite(route.distance_km) || route.distance_km <= 0) {
    fail("distance_km must be a positive number");
  }
  if (
    route.elevation_status === "unavailable"
      ? route.elevation_gain_m !== null
      : !Number.isFinite(route.elevation_gain_m) || route.elevation_gain_m < 0
  ) {
    fail("elevation_gain_m must agree with elevation availability");
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
    const elevationRecorded = route.elevation_status !== "unavailable";
    if (
      ![point.lat, point.lng, point.d].every(Number.isFinite) ||
      (elevationRecorded ? !Number.isFinite(point.elev) : point.elev !== null)
    ) {
      fail(
        `route point ${index} must contain valid lat, lng, elevation, and distance values`,
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

if (!routeSlug || !/^[A-Za-z0-9._-]+$/.test(routeSlug)) {
  fail("provide a safe route slug as the first argument");
}
if (!new Set(["source", "dist"]).has(mode)) {
  fail("mode must be source or dist");
}

const sourcePath = path.join(root, "app/public/data/routes", `${routeSlug}.json`);
if (!fs.existsSync(sourcePath)) fail(`missing source route ${sourcePath}`);
validateRoute(readJson(sourcePath), routeSlug);

if (mode === "dist") {
  const dataDir = path.join(root, "dist/data");
  const expectedRoutePath = `routes/${routeSlug}.json`;
  const dataFiles = listFiles(dataDir).sort();
  if (dataFiles.length !== 1 || dataFiles[0] !== expectedRoutePath) {
    fail(`built bundle data must contain only ${expectedRoutePath}`);
  }
  const builtRoute = readJson(path.join(dataDir, expectedRoutePath));
  validateRoute(builtRoute, routeSlug);

  const expectedMedia = [...collectMediaReferences(builtRoute)].sort();
  for (const reference of expectedMedia) {
    if (
      path.posix.normalize(reference) !== reference ||
      !reference.startsWith(`media/${routeSlug}/`)
    ) {
      fail(`route media reference is outside media/${routeSlug}: ${reference}`);
    }
  }
  const builtMedia = listFiles(path.join(root, "dist/media"))
    .map((file) => `media/${file}`)
    .sort();
  if (JSON.stringify(builtMedia) !== JSON.stringify(expectedMedia)) {
    fail("built bundle media must contain only files referenced by the shared route");
  }

  const robots = fs.readFileSync(path.join(root, "dist/robots.txt"), "utf8");
  if (!robots.includes("Disallow: /")) {
    fail("single-route bundle must be excluded from search indexing");
  }
  const headers = fs.readFileSync(path.join(root, "dist/_headers"), "utf8");
  if (!/^\/\*\s*\n\s*X-Robots-Tag:\s*[^\n]*\bnoindex\b/im.test(headers)) {
    fail("single-route bundle must send a site-wide X-Robots-Tag noindex header");
  }
}

console.log(`Validated ${routeSlug} (${mode}).`);
