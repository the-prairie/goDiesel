import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PNG } from "pngjs";
import { chromium } from "playwright";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPOSITORY_ROOT = resolve(APP_ROOT, "..");
const PUBLIC_ROOT = join(APP_ROOT, "public/world-packs");
const EXPECTED_PROOF = join(
  REPOSITORY_ROOT,
  "docs/world-packs/proof/film-proof.json",
);
const WORLDS = [
  { routeSlug: "17665674778", worldId: "tokyo-urban" },
  { routeSlug: "15573295095", worldId: "banff-mountain" },
  { routeSlug: "6496900063", worldId: "ucluelet-coastal" },
];
const PROVIDER_CREDENTIAL_NAMES = [
  "CESIUM_ION_ACCESS_TOKEN",
  "GOOGLE_MAPS_API_KEY",
  "MAPBOX_ACCESS_TOKEN",
  "MAPBOX_TOKEN",
  "VITE_GOOGLE_MAPS_API_KEY",
];
const SAMPLE_SECONDS = [0, 11.25, 22.5, 33.75, 44.958333];

function argument(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

const baseUrl = argument("base-url", "http://127.0.0.1:8796");
const filmRoot = resolve(
  argument("film-dir", "../world-packs-local/films"),
);

for (const name of PROVIDER_CREDENTIAL_NAMES) delete process.env[name];

const index = JSON.parse(
  await readFile(join(PUBLIC_ROOT, "index.json"), "utf8"),
);
const browser = await chromium.launch({ headless: true });
let proof;
try {
  proof = {
    schemaVersion: 1,
    renderer: "deterministic-topographic-v1",
    providerCredentialsRemoved: PROVIDER_CREDENTIAL_NAMES,
    deterministicSampleRepeats: 2,
    sampleSeconds: SAMPLE_SECONDS,
    worlds: [],
  };
  for (const world of WORLDS) {
    proof.worlds.push(await proveWorld(world));
  }
} finally {
  await browser.close();
}

const serialized = `${JSON.stringify(proof, null, 2)}\n`;
if (process.argv.includes("--update")) {
  await writeFile(EXPECTED_PROOF, serialized);
  process.stdout.write(`Updated ${EXPECTED_PROOF}.\n`);
} else if (process.argv.includes("--print")) {
  process.stdout.write(serialized);
} else {
  const expected = await readFile(EXPECTED_PROOF, "utf8");
  if (expected !== serialized) {
    process.stderr.write(serialized);
    throw new Error(`Film proof differs from ${EXPECTED_PROOF}.`);
  }
  process.stdout.write(
    `Verified deterministic films for ${proof.worlds.length} sealed World Packs.\n`,
  );
}

async function proveWorld(world) {
  const entry = index.packs[world.routeSlug];
  if (!entry || entry.worldId !== world.worldId) {
    throw new Error(`${world.worldId} is not the active reference pack.`);
  }
  const reportPath = join(filmRoot, world.worldId, "render-report.json");
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  if (
    report.packId !== entry.packId ||
    report.renderer !== "deterministic-topographic-v1" ||
    report.providerCredentialsRequired !== false ||
    report.providerRequests !== 0 ||
    report.durationSeconds !== 45 ||
    report.framesPerSecond !== 24 ||
    report.fullRouteFrameCount !== 1080 ||
    report.teaserFrameCount !== 360
  ) {
    throw new Error(`${world.worldId} render report does not match the film contract.`);
  }

  const outputs = [];
  for (const output of report.outputs) {
    const path = join(dirname(reportPath), basename(output.path));
    const fileStat = await stat(path);
    const sha256 = await sha256File(path);
    if (fileStat.size !== output.byteSize || sha256 !== output.sha256) {
      throw new Error(`${world.worldId}/${basename(path)} differs from its report.`);
    }
    const record = {
      name: basename(path),
      byteSize: fileStat.size,
      sha256,
    };
    if (path.endsWith(".mp4")) {
      record.media = await inspectMedia(path);
      validateMedia(record.name, record.media, report);
    }
    outputs.push(record);
  }

  const renderPasses = [];
  let providerRequests = 0;
  for (let pass = 0; pass < 2; pass += 1) {
    const result = await renderSamples(world.routeSlug, entry.packId, report);
    renderPasses.push(result.samples);
    providerRequests += result.providerRequests;
  }
  for (let index = 0; index < SAMPLE_SECONDS.length; index += 1) {
    if (renderPasses[0][index].sha256 !== renderPasses[1][index].sha256) {
      throw new Error(
        `${world.worldId} sample at ${SAMPLE_SECONDS[index]} seconds is not deterministic.`,
      );
    }
    if (renderPasses[0][index].quantizedColorBins < 16) {
      throw new Error(`${world.worldId} sample at ${SAMPLE_SECONDS[index]} seconds is blank.`);
    }
  }
  if (providerRequests !== 0) {
    throw new Error(`${world.worldId} made ${providerRequests} provider requests.`);
  }

  return {
    routeSlug: world.routeSlug,
    worldId: world.worldId,
    packId: report.packId,
    timelineId: report.timelineId,
    durationSeconds: report.durationSeconds,
    framesPerSecond: report.framesPerSecond,
    providerRequests,
    providerCredentialsRequired: false,
    pixelExactAcrossRepeats: true,
    samples: renderPasses[0],
    outputs,
  };
}

async function renderSamples(routeSlug, expectedPackId, report) {
  const page = await browser.newPage({
    deviceScaleFactor: 1,
    viewport: report.landscape,
  });
  const attemptedProviders = [];
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (
      url.startsWith(baseUrl) ||
      url.startsWith("data:") ||
      url.startsWith("blob:")
    ) {
      await route.continue();
      return;
    }
    attemptedProviders.push(url);
    await route.abort("blockedbyclient");
  });
  await page.goto(`${baseUrl}/#/lab/playable-earth/${routeSlug}?render=film`, {
    waitUntil: "domcontentloaded",
  });
  const canvas = page.locator("canvas[data-world-pack-state=ready]");
  await canvas.waitFor({ state: "visible", timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready);
  if (
    (await canvas.getAttribute("data-world-pack-id")) !== expectedPackId ||
    (await canvas.getAttribute("data-cinematic-timeline")) !== report.timelineId ||
    (await canvas.getAttribute("data-film-renderer")) !== report.renderer
  ) {
    throw new Error(`${routeSlug} loaded a different film contract.`);
  }
  const samples = [];
  for (const seconds of SAMPLE_SECONDS) {
    await page.evaluate((time) => {
      window.dispatchEvent(
        new CustomEvent("godiesel:world-pack-film-seek", {
          detail: { seconds: time },
        }),
      );
    }, seconds);
    const png = await canvas.screenshot();
    samples.push({
      seconds,
      sha256: createHash("sha256").update(png).digest("hex"),
      quantizedColorBins: countQuantizedColors(png),
    });
  }
  await page.close();
  return { samples, providerRequests: attemptedProviders.length };
}

function countQuantizedColors(buffer) {
  const png = PNG.sync.read(buffer);
  const colors = new Set();
  for (let index = 0; index < png.data.length; index += 16) {
    const red = png.data[index] >> 4;
    const green = png.data[index + 1] >> 4;
    const blue = png.data[index + 2] >> 4;
    colors.add((red << 8) | (green << 4) | blue);
  }
  return colors.size;
}

async function inspectMedia(path) {
  const output = await run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "stream=codec_name,codec_type,width,height,r_frame_rate",
    "-show_entries",
    "format=duration",
    "-of",
    "json",
    path,
  ]);
  const parsed = JSON.parse(output);
  const video = parsed.streams.find((stream) => stream.codec_type === "video");
  const audio = parsed.streams.find((stream) => stream.codec_type === "audio");
  return {
    durationSeconds: Number(parsed.format.duration),
    videoCodec: video?.codec_name,
    audioCodec: audio?.codec_name,
    width: video?.width,
    height: video?.height,
    framesPerSecond: video?.r_frame_rate,
  };
}

function validateMedia(name, media, report) {
  const vertical = name === "vertical-teaser.mp4";
  const teaser = name !== "full-route-film.mp4";
  const dimensions = vertical ? report.vertical : report.landscape;
  const expectedDuration = teaser ? 15 : 45;
  if (
    media.videoCodec !== "h264" ||
    media.audioCodec !== "aac" ||
    media.width !== dimensions.width ||
    media.height !== dimensions.height ||
    media.framesPerSecond !== "24/1" ||
    Math.abs(media.durationSeconds - expectedDuration) > 0.05
  ) {
    throw new Error(`${name} does not match the published media contract.`);
  }
}

async function sha256File(path) {
  const digest = createHash("sha256");
  await new Promise((resolvePromise, rejectPromise) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => digest.update(chunk));
    stream.on("error", rejectPromise);
    stream.on("end", resolvePromise);
  });
  return digest.digest("hex");
}

async function run(command, args) {
  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let standardOutput = "";
    let errorOutput = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      standardOutput += chunk;
    });
    child.stderr.on("data", (chunk) => {
      errorOutput += chunk;
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code === 0) resolvePromise(standardOutput);
      else rejectPromise(new Error(`${command} failed with ${code}: ${errorOutput}`));
    });
  });
}
