import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
  mkdir,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { chromium } from "playwright";

const WORLDS = {
  "15573295095": { id: "banff-mountain", soundHz: 55 },
  "17665674778": { id: "tokyo-urban", soundHz: 65.41 },
  "6496900063": { id: "ucluelet-coastal", soundHz: 61.74 },
};

function argument(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

const baseUrl = argument("base-url", "http://127.0.0.1:8796");
const routeArgument = argument("route", "all");
const fps = Number(argument("fps", "24"));
const landscapeWidth = Number(argument("width", "1280"));
const landscapeHeight = Number(argument("height", "720"));
const verticalWidth = Number(argument("vertical-width", "720"));
const verticalHeight = Number(argument("vertical-height", "1280"));
const outputRoot = resolve(
  argument("output-dir", "../world-packs-local/films"),
);

if (
  !Number.isInteger(fps) ||
  fps < 12 ||
  !Number.isInteger(landscapeWidth) ||
  !Number.isInteger(landscapeHeight) ||
  !Number.isInteger(verticalWidth) ||
  !Number.isInteger(verticalHeight)
) {
  throw new Error("Film dimensions and frame rate must be valid integers.");
}

for (const name of [
  "CESIUM_ION_ACCESS_TOKEN",
  "GOOGLE_MAPS_API_KEY",
  "MAPBOX_ACCESS_TOKEN",
  "MAPBOX_TOKEN",
  "VITE_GOOGLE_MAPS_API_KEY",
]) {
  delete process.env[name];
}

const routeSlugs =
  routeArgument === "all"
    ? Object.keys(WORLDS)
    : routeArgument in WORLDS
      ? [routeArgument]
      : (() => {
          throw new Error(`Unknown reference route ${routeArgument}.`);
        })();

const browser = await chromium.launch({ headless: true });
try {
  for (const routeSlug of routeSlugs) {
    await renderWorld(routeSlug);
  }
} finally {
  await browser.close();
}

async function renderWorld(routeSlug) {
  const world = WORLDS[routeSlug];
  const outputDirectory = join(outputRoot, world.id);
  const landscapeFrames = join(outputDirectory, ".landscape-frames");
  const verticalFrames = join(outputDirectory, ".vertical-frames");
  await rm(landscapeFrames, { force: true, recursive: true });
  await rm(verticalFrames, { force: true, recursive: true });
  await mkdir(landscapeFrames, { recursive: true });
  await mkdir(verticalFrames, { recursive: true });

  const page = await browser.newPage({
    deviceScaleFactor: 1,
    viewport: { width: landscapeWidth, height: landscapeHeight },
  });
  const providerRequests = [];
  page.on("request", (request) => {
    const url = request.url();
    if (
      !url.startsWith(baseUrl) &&
      !url.startsWith("data:") &&
      !url.startsWith("blob:")
    ) {
      providerRequests.push(url);
    }
  });
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
    providerRequests.push(url);
    await route.abort("blockedbyclient");
  });
  await page.goto(
    `${baseUrl}/#/lab/playable-earth/${routeSlug}?render=film`,
    { waitUntil: "domcontentloaded" },
  );
  const canvas = page.locator("canvas[data-world-pack-state=ready]");
  await canvas.waitFor({ state: "visible", timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready);
  const durationSeconds = Number(
    await canvas.getAttribute("data-cinematic-duration"),
  );
  const packId = await canvas.getAttribute("data-world-pack-id");
  const timelineId = await canvas.getAttribute("data-cinematic-timeline");
  const renderer = await canvas.getAttribute("data-film-renderer");
  await assertCanvasSize(canvas, landscapeWidth, landscapeHeight);
  if (
    durationSeconds !== 45 ||
    !packId ||
    !timelineId ||
    renderer !== "deterministic-topographic-v1"
  ) {
    throw new Error(`${world.id} did not expose the sealed film contract.`);
  }

  console.log(`Rendering ${world.id} full route film from ${packId}.`);
  const fullFrameCount = Math.round(durationSeconds * fps);
  await captureFrames({
    canvas,
    durationSeconds,
    frameCount: fullFrameCount,
    frameDirectory: landscapeFrames,
    page,
  });
  const posterIndices = [0, Math.floor(fullFrameCount / 2), fullFrameCount - 1];
  for (const [posterIndex, frameIndex] of posterIndices.entries()) {
    await copyFile(
      framePath(landscapeFrames, frameIndex),
      join(outputDirectory, `poster-${posterIndex + 1}.png`),
    );
  }

  const fullFilm = join(outputDirectory, "full-route-film.mp4");
  await encodeFrames({
    durationSeconds,
    fps,
    frameDirectory: landscapeFrames,
    output: fullFilm,
    soundHz: world.soundHz,
  });
  const landscapeTeaser = join(outputDirectory, "landscape-teaser.mp4");
  await encodeLandscapeTeaser(fullFilm, landscapeTeaser);

  await page.setViewportSize({ width: verticalWidth, height: verticalHeight });
  await assertCanvasSize(canvas, verticalWidth, verticalHeight);
  const verticalFrameCount = 15 * fps;
  await captureFrames({
    canvas,
    durationSeconds,
    frameCount: verticalFrameCount,
    frameDirectory: verticalFrames,
    page,
  });
  const verticalTeaser = join(outputDirectory, "vertical-teaser.mp4");
  await encodeFrames({
    durationSeconds: 15,
    fps,
    frameDirectory: verticalFrames,
    output: verticalTeaser,
    soundHz: world.soundHz,
  });
  await page.close();

  if (providerRequests.length > 0) {
    throw new Error(
      `${world.id} attempted provider requests: ${providerRequests.join(", ")}`,
    );
  }
  const outputPaths = [
    fullFilm,
    landscapeTeaser,
    verticalTeaser,
    ...[1, 2, 3].map((index) =>
      join(outputDirectory, `poster-${index}.png`),
    ),
  ];
  const outputs = [];
  for (const path of outputPaths) {
    outputs.push({
      byteSize: (await stat(path)).size,
      path,
      sha256: await sha256File(path),
    });
  }
  const report = {
    schemaVersion: 1,
    worldId: world.id,
    routeSlug,
    packId,
    timelineId,
    renderer,
    providerCredentialsRequired: false,
    providerRequests: 0,
    durationSeconds,
    framesPerSecond: fps,
    landscape: { width: landscapeWidth, height: landscapeHeight },
    vertical: { width: verticalWidth, height: verticalHeight },
    fullRouteFrameCount: fullFrameCount,
    teaserFrameCount: verticalFrameCount,
    outputs,
  };
  await writeFile(
    join(outputDirectory, "render-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  await rm(landscapeFrames, { force: true, recursive: true });
  await rm(verticalFrames, { force: true, recursive: true });
  console.log(`Completed ${world.id}: ${outputDirectory}`);
}

async function captureFrames({
  canvas,
  durationSeconds,
  frameCount,
  frameDirectory,
  page,
}) {
  const denominator = Math.max(1, frameCount - 1);
  for (let index = 0; index < frameCount; index += 1) {
    const seconds = (index / denominator) * (durationSeconds - 1 / fps);
    await page.evaluate((time) => {
      window.dispatchEvent(
        new CustomEvent("godiesel:world-pack-film-seek", {
          detail: { seconds: time },
        }),
      );
    }, seconds);
    await canvas.screenshot({ path: framePath(frameDirectory, index) });
    if (index % (fps * 5) === 0) {
      console.log(`  captured ${index}/${frameCount} frames`);
    }
  }
}

async function assertCanvasSize(canvas, expectedWidth, expectedHeight) {
  const box = await canvas.boundingBox();
  if (
    !box ||
    Math.round(box.width) !== expectedWidth ||
    Math.round(box.height) !== expectedHeight
  ) {
    throw new Error(
      `Film canvas is ${box?.width ?? 0}x${box?.height ?? 0}, expected ${expectedWidth}x${expectedHeight}.`,
    );
  }
}

function framePath(directory, index) {
  return join(directory, `frame-${String(index).padStart(6, "0")}.png`);
}

async function encodeFrames({
  durationSeconds,
  fps,
  frameDirectory,
  output,
  soundHz,
}) {
  await mkdir(dirname(output), { recursive: true });
  await run("ffmpeg", [
    "-y",
    "-framerate",
    String(fps),
    "-i",
    join(frameDirectory, "frame-%06d.png"),
    "-f",
    "lavfi",
    "-i",
    "anoisesrc=color=pink:amplitude=0.035:sample_rate=48000:seed=1337",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${soundHz}:sample_rate=48000`,
    "-filter_complex",
    `[1:a]lowpass=f=900,highpass=f=48,volume=0.35[air];[2:a]lowpass=f=260,volume=0.055[tone];[air][tone]amix=inputs=2:duration=shortest,afade=t=in:st=0:d=1.5,afade=t=out:st=${Math.max(0, durationSeconds - 2)}:d=2[a]`,
    "-map",
    "0:v",
    "-map",
    "[a]",
    "-t",
    String(durationSeconds),
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    output,
  ]);
}

async function encodeLandscapeTeaser(input, output) {
  await run("ffmpeg", [
    "-y",
    "-i",
    input,
    "-filter_complex",
    "[0:v]setpts=PTS/3[v];[0:a]atempo=2,atempo=1.5[a]",
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-t",
    "15",
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    output,
  ]);
}

async function run(command, args) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let errorOutput = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      errorOutput = `${errorOutput}${chunk}`.slice(-12_000);
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`${command} failed with ${code}: ${errorOutput}`));
    });
  });
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

const leftovers = await readdir(outputRoot).catch(() => []);
if (leftovers.length === 0) await rm(outputRoot, { force: true, recursive: true });
