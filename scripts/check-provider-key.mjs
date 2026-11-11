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
 *
 * A local build may omit the key. A public deployment sets
 * GODIESEL_REQUIRE_PROVIDER_KEY=1, and then a missing key is a failure.
 *
 * A configured key is also checked against Google, because Google never tells
 * the 3D Maps page that it rejected a key: the site would ship and every
 * visitor would see "Google 3D is unavailable". The check asks the Map Tiles
 * API's 3D Tiles root (one billable root-tile request per build):
 *   - Google answers that the key is invalid (API_KEY_INVALID): the build FAILS.
 *   - Google serves the tileset: the key is verified.
 *   - Google names the key but blocks it by a referrer, IP or app restriction
 *     (a correctly restricted browser key, asked from a build machine): the
 *     key exists, so this passes with a WARNING that 3D Tiles access could not
 *     be confirmed from here.
 *   - Anything else (network failure, timeout, another error): a WARNING, and
 *     a FAILURE ("could not verify") when GODIESEL_REQUIRE_PROVIDER_KEY=1.
 * Set GODIESEL_SKIP_PROVIDER_KEY_VERIFY=1 to skip the request (an offline
 * build); the check then prints a WARNING and still passes.
 * Output never contains the key, only its last four characters.
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

const TILES_ROOT = "https://tile.googleapis.com/v1/3dtiles/root.json";
const ERROR_INFO_TYPE = "type.googleapis.com/google.rpc.ErrorInfo";
const RESTRICTION_REASONS = new Set([
  "API_KEY_HTTP_REFERRER_BLOCKED",
  "API_KEY_IP_ADDRESS_BLOCKED",
  "API_KEY_ANDROID_APP_BLOCKED",
  "API_KEY_IOS_APP_BLOCKED",
]);

function warn(message) {
  console.warn(`WARNING: ${message}`);
}

/** Classifies Google's answer for the 3D Tiles root. Mirrors app/src/providers/google-key-preflight.ts. */
function classify(status, body) {
  if (status === 200) return { outcome: "valid" };
  const error = body && typeof body === "object" ? body.error : undefined;
  const details = Array.isArray(error?.details) ? error.details : [];
  const reason = details.find((detail) => detail?.["@type"] === ERROR_INFO_TYPE)?.reason;
  if ((status === 400 || status === 403) && (error?.status === "API_KEY_INVALID" || reason === "API_KEY_INVALID")) {
    return { outcome: "invalid" };
  }
  if (status === 403 && RESTRICTION_REASONS.has(reason)) return { outcome: "restricted", reason };
  return { outcome: "unknown", detail: `HTTP ${status}${reason ? ` ${reason}` : error?.status ? ` ${error.status}` : ""}` };
}

async function verifyWithGoogle(apiKey) {
  try {
    const response = await fetch(`${TILES_ROOT}?key=${encodeURIComponent(apiKey)}`, {
      signal: AbortSignal.timeout(8_000),
    });
    const body = await response.json().catch(() => null);
    return classify(response.status, body);
  } catch (error) {
    const name = error?.name === "TimeoutError" ? "no answer within 8 s" : "network request failed";
    return { outcome: "unknown", detail: name };
  }
}

const label = `key ending ...${key.slice(-4)}`;
if (process.env.GODIESEL_SKIP_PROVIDER_KEY_VERIFY === "1") {
  warn(`the Google Maps ${label} was not verified with Google (GODIESEL_SKIP_PROVIDER_KEY_VERIFY=1).`);
} else {
  const verdict = await verifyWithGoogle(key);
  if (verdict.outcome === "invalid") {
    fail(
      `Google rejects the configured Google Maps ${label}: the Map Tiles API answered API_KEY_INVALID. ` +
        "Every visitor would see \"Google 3D is unavailable\". Replace the key in .env or the build environment.",
    );
  } else if (verdict.outcome === "valid") {
    console.log(`Provider key verified: Google serves 3D Tiles for the ${label}.`);
  } else if (verdict.outcome === "restricted") {
    warn(
      `Google recognises the ${label} but blocks this machine (${verdict.reason}). ` +
        "That is expected for a browser key restricted to the site's origins; 3D Tiles access was not confirmed.",
    );
  } else if (process.env.GODIESEL_REQUIRE_PROVIDER_KEY === "1") {
    fail(
      `could not verify the Google Maps ${label} with Google (${verdict.detail}). ` +
        "A public deployment needs a verified key; set GODIESEL_SKIP_PROVIDER_KEY_VERIFY=1 to package without verifying.",
    );
  } else {
    warn(`could not verify the Google Maps ${label} with Google (${verdict.detail}).`);
  }
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
