import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

/**
 * Refuse to package a build that cannot reach its providers.
 *
 * app/playwright.config.ts builds with GODIESEL_DISABLE_LIVE_PROVIDERS=1, which
 * blanks the Google key on purpose so the deterministic suite cannot depend on
 * a live provider. If that variable is still set when the deployable bundle is
 * built, the site ships with no key and photorealistic replay silently never
 * works. Nothing else would notice: the tests are meant to pass without a key.
 */

const root = path.resolve(import.meta.dirname, "..");

function fail(message) {
  console.error(`Provider key check failed: ${message}`);
  process.exit(1);
}

async function configuredKey() {
  if (process.env.VITE_GOOGLE_MAPS_API_KEY) return process.env.VITE_GOOGLE_MAPS_API_KEY;
  if (process.env.GOOGLE_MAPS_API_KEY) return process.env.GOOGLE_MAPS_API_KEY;
  try {
    const text = await readFile(path.join(root, ".env"), "utf8");
    for (const line of text.split("\n")) {
      const match = line.match(/^\s*(?:VITE_)?GOOGLE_MAPS_API_KEY\s*=\s*(.+)\s*$/);
      if (match) return match[1].trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    return "";
  }
  return "";
}

const key = await configuredKey();
if (!key) {
  if (process.env.GODIESEL_REQUIRE_PROVIDER_KEY === "1") {
    fail("a Google Maps key is required for a public deployment.");
  }
  console.log("Provider key check skipped: no Google Maps key is configured.");
  process.exit(0);
}

if (process.env.GODIESEL_DISABLE_LIVE_PROVIDERS === "1") {
  fail(
    "GODIESEL_DISABLE_LIVE_PROVIDERS=1 is set, so the build blanked the Google key. " +
      "That variable belongs to the test web server, not to a deployable build.",
  );
}

const assets = path.join(root, "app", "dist", "assets");
let files;
try {
  files = (await readdir(assets)).filter((name) => name.endsWith(".js"));
} catch {
  fail(`no built assets at ${assets}`);
}

let baked = false;
for (const name of files) {
  const contents = await readFile(path.join(assets, name), "utf8");
  if (contents.includes(key)) {
    baked = true;
    break;
  }
}

if (!baked) {
  fail(
    "a Google Maps key is configured, but no built asset contains it. " +
      "Photorealistic replay would fail silently in production.",
  );
}

console.log("Provider key check passed: the build carries its Google Maps key.");
