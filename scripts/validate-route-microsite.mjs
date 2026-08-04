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
  if (route.slug !== expectedSlug) fail(`route slug must equal ${expectedSlug}`);

  for (const field of ["name", "region", "date", "type", "description"]) {
    if (typeof route[field] !== "string" || !route[field].trim()) {
      fail(`${field} is required`);
    }
  }

  if (!(route.subtitle || route.activity_name)) {
    fail("subtitle or activity_name is required for the public route title");
  }
  if (!Number.isFinite(route.distance_km) || route.distance_km <= 0) {
    fail("distance_km must be a positive number");
  }
  if (!Array.isArray(route.route) || route.route.length < 2) {
    fail("route geometry must contain at least two points");
  }

  let previousDistance = -Infinity;
  for (const [index, point] of route.route.entries()) {
    if (![point.lat, point.lng, point.d].every(Number.isFinite)) {
      fail(`route point ${index} must contain finite lat, lng, and d values`);
    }
    if (point.d < previousDistance) {
      fail(`route distance decreases at point ${index}`);
    }
    previousDistance = point.d;
  }

  if (route.replay?.replay_eligible !== true) {
    fail("replay.replay_eligible must be true");
  }
  if (route.replay?.geometry_status !== "ready") {
    fail("replay.geometry_status must be ready");
  }
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
  const routesDir = path.join(root, "dist/data/routes");
  const routeFiles = fs
    .readdirSync(routesDir)
    .filter((file) => file.endsWith(".json"));
  if (routeFiles.length !== 1 || routeFiles[0] !== `${routeSlug}.json`) {
    fail(`built bundle must contain only ${routeSlug}.json`);
  }
  validateRoute(readJson(path.join(routesDir, routeFiles[0])), routeSlug);

  const robots = fs.readFileSync(path.join(root, "dist/robots.txt"), "utf8");
  if (!robots.includes("Disallow: /")) {
    fail("single-route bundle must be excluded from search indexing");
  }
}

console.log(`Validated ${routeSlug} (${mode}).`);
