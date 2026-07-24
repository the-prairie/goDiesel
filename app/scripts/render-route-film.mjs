import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { chromium } from "playwright";
import { PNG } from "pngjs";

function argument(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

const slug = argument("route", "14023448720");
const baseUrl = argument("base-url", "http://localhost:8787");
const width = Number(argument("width", "1920"));
const height = Number(argument("height", "1080"));
const fps = Number(argument("fps", "24"));
const motionSamples = Number(argument("motion-samples", "2"));
const spatialScale = Number(argument("spatial-scale", "1.5"));
const maxSeconds = Number(argument("max-seconds", "0"));
const preflight = argument("preflight", "true") !== "false";
const allowUnsettled = argument("allow-unsettled", "false") === "true";
const output = resolve(
  argument(
    "output",
    `artifacts/route-films/${slug}-${width}x${height}-${fps}fps.mp4`,
  ),
);
const headed = process.argv.includes("--headed");

if (
  !Number.isFinite(width) ||
  !Number.isFinite(height) ||
  !Number.isFinite(fps) ||
  !Number.isFinite(motionSamples) ||
  !Number.isFinite(spatialScale) ||
  width < 640 ||
  height < 360 ||
  fps < 1 ||
  motionSamples < 1 ||
  motionSamples > 4 ||
  !Number.isInteger(motionSamples) ||
  spatialScale < 1 ||
  spatialScale > 2
) {
  throw new Error(
    "width, height, fps, motion-samples (1-4), and spatial-scale (1-2) must be valid render values",
  );
}

await mkdir(dirname(output), { recursive: true });

const captureFps = fps * motionSamples;
const captureWidth = Math.round(width * spatialScale);
const captureHeight = Math.round(height * spatialScale);
const browser = await chromium.launch({
  headless: !headed,
  args: [
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--use-angle=metal",
  ],
});
const page = await browser.newPage({
  deviceScaleFactor: 1,
  viewport: { width: captureWidth, height: captureHeight },
});

const filmUrl = `${baseUrl}/#/lab/cinematic-director/${slug}?render=1`;
console.log(`Staging ${filmUrl}`);
console.log(
  `Mastering ${width}x${height} at ${fps} fps from ${captureWidth}x${captureHeight} and ${captureFps} temporal fps`,
);
await page.goto(filmUrl, { waitUntil: "domcontentloaded" });
const film = page.getByTestId("cinematic-director");
await film.waitFor({ state: "visible", timeout: 30_000 });
await page.waitForFunction(
  () => {
    const state = document
      .querySelector('[data-testid="cinematic-director"]')
      ?.getAttribute("data-state");
    return state === "ready" || state === "unavailable";
  },
  undefined,
  { timeout: 30_000 },
);
const providerState = await film.getAttribute("data-state");
if (providerState !== "ready") {
  const message = await film.getByRole("alert").textContent().catch(() => "");
  await browser.close();
  throw new Error(
    `Photorealistic provider unavailable at ${baseUrl}: ${message || providerState}`,
  );
}

const completeDuration = Number(await film.getAttribute("data-duration"));
const shotCount = Number(await film.getAttribute("data-shot-count"));
const shotTimeline = JSON.parse(
  (await film.getAttribute("data-shot-timeline")) ?? "[]",
);
const terrainCharacter =
  (await film.getAttribute("data-terrain-character")) ?? "rolling";
const duration =
  maxSeconds > 0 ? Math.min(maxSeconds, completeDuration) : completeDuration;

if (
  shotTimeline.length !== shotCount ||
  shotTimeline.some(
    (shot) =>
      !Number.isFinite(shot.startSeconds) ||
      !Number.isFinite(shot.endSeconds) ||
      shot.endSeconds <= shot.startSeconds,
  )
) {
  await browser.close();
  throw new Error("The route film did not expose a valid shot timeline");
}

await seekFilm(page, Math.min(1.2, completeDuration * 0.08));
await waitForVisualSettle(page, {
  allowUnsettled,
  attempts: 8,
  delayMs: 650,
});
await seekFilm(page, 0);

if (preflight) {
  console.log(
    `Preflighting ${shotCount} acts at entrance and midpoint to warm photorealistic tiles`,
  );
  for (const shot of shotTimeline) {
    for (const position of [0.12, 0.56]) {
      const seconds =
        shot.startSeconds +
        (shot.endSeconds - shot.startSeconds) * position;
      await seekFilm(page, seconds);
      await waitForVisualSettle(page, { allowUnsettled });
    }
  }
  await seekFilm(page, 0);
  await page.waitForTimeout(1_200);
}

const totalFrames = Math.ceil(duration * captureFps);
const fadeOutStart = Math.max(0, duration - 2);
const temporalFilter =
  motionSamples > 1
    ? `tmix=frames=${motionSamples}:weights=${Array.from({ length: motionSamples }, () => "1").join(" ")},fps=${fps},`
    : "";
const videoFilter = `${temporalFilter}scale=${width}:${height}:flags=lanczos,setsar=1`;
const scoreFrequencies = {
  mountain: [55, 82.41, 110],
  open: [65.41, 98, 130.81],
  rolling: [61.74, 92.5, 123.47],
}[terrainCharacter] ?? [61.74, 92.5, 123.47];
const windVolume = timelineVolumeExpression(shotTimeline, {
  establishing: 0.1,
  release: 0.09,
  reveal: 0.16,
  summit: 0.12,
  tracking: 0.21,
});
const airVolume = timelineVolumeExpression(shotTimeline, {
  establishing: 0.025,
  release: 0.02,
  reveal: 0.05,
  summit: 0.03,
  tracking: 0.065,
});
const scoreVolume = timelineVolumeExpression(shotTimeline, {
  establishing: 0.006,
  release: 0.012,
  reveal: 0.009,
  summit: 0.016,
  tracking: 0.011,
});
const audioFilter = [
  "[1:a]asplit=2[windraw][airraw]",
  `[windraw]highpass=f=45,lowpass=f=720,volume='${windVolume}':eval=frame,pan=stereo|c0=0.82*c0|c1=0.34*c0[wind]`,
  `[airraw]highpass=f=1800,lowpass=f=4200,volume='${airVolume}':eval=frame,pan=stereo|c0=0.28*c0|c1=0.76*c0[air]`,
  "[2:a]lowpass=f=180,volume=0.038,pan=stereo|c0=0.48*c0|c1=0.48*c0[pulse]",
  `[3:a]lowpass=f=520,volume='${scoreVolume}':eval=frame,pan=stereo|c0=0.62*c0|c1=0.42*c0[score]`,
  `[4:a]lowpass=f=760,volume='${scoreVolume}*0.58':eval=frame,pan=stereo|c0=0.35*c0|c1=0.7*c0[harmony]`,
  `[wind][air][pulse][score][harmony]amix=inputs=5:duration=shortest:normalize=0,afade=t=in:st=0:d=1.8,afade=t=out:st=${fadeOutStart}:d=2[a]`,
].join(";");

const ffmpeg = spawn(
  "ffmpeg",
  [
    "-y",
    "-f",
    "image2pipe",
    "-vcodec",
    "mjpeg",
    "-framerate",
    String(captureFps),
    "-i",
    "pipe:0",
    "-f",
    "lavfi",
    "-i",
    `anoisesrc=color=pink:amplitude=0.018:seed=424242:duration=${duration}`,
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=48:sample_rate=48000:duration=${duration}`,
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${scoreFrequencies[0]}:sample_rate=48000:duration=${duration}`,
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${scoreFrequencies[2]}:sample_rate=48000:duration=${duration}`,
    "-filter_complex",
    audioFilter,
    "-vf",
    videoFilter,
    "-map",
    "0:v",
    "-map",
    "[a]",
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "15",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    "-shortest",
    output,
  ],
  { stdio: ["pipe", "inherit", "inherit"] },
);

let previousChapter;
for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
  const seconds = frameIndex / captureFps;
  await seekFilm(page, seconds);

  const chapter = await film.getAttribute("data-chapter");
  if (chapter !== previousChapter) {
    previousChapter = chapter;
    await page.waitForTimeout(frameIndex === 0 ? 1_600 : 900);
  } else {
    await page.waitForTimeout(Math.max(12, 500 / captureFps));
  }

  const jpeg = await page.screenshot({
    animations: "disabled",
    quality: 96,
    type: "jpeg",
  });
  if (!ffmpeg.stdin.write(jpeg)) {
    await new Promise((done) => ffmpeg.stdin.once("drain", done));
  }
  if (frameIndex % captureFps === 0) {
    console.log(
      `Rendered ${Math.min(duration, seconds).toFixed(0)}s / ${duration.toFixed(0)}s`,
    );
  }
}

ffmpeg.stdin.end();
const exitCode = await new Promise((done) => ffmpeg.once("close", done));
await browser.close();

if (exitCode !== 0) {
  throw new Error(`ffmpeg exited with code ${exitCode}`);
}

console.log(`Route Film written to ${output}`);

async function seekFilm(page, seconds) {
  await page.evaluate((time) => {
    window.dispatchEvent(
      new CustomEvent("godiesel:route-film-seek", {
        detail: { seconds: time },
      }),
    );
  }, seconds);
  await page.waitForFunction(
    (time) => {
      const value = document
        .querySelector('[data-testid="cinematic-director"]')
        ?.getAttribute("data-frame-seconds");
      return value !== null && Math.abs(Number(value) - time) < 0.01;
    },
    seconds,
  );
}

async function waitForVisualSettle(
  page,
  { allowUnsettled = false, attempts = 6, delayMs = 450 } = {},
) {
  let previousPixels;
  let bestColorBins = 0;
  let bestLuminanceVariance = 0;
  let stableSamples = 0;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await page.waitForTimeout(delayMs);
    const image = await page.getByTestId("cinematic-world").screenshot({
      animations: "disabled",
      type: "png",
    });
    const sample = visualSample(image);
    bestColorBins = Math.max(bestColorBins, sample.colorBins);
    bestLuminanceVariance = Math.max(
      bestLuminanceVariance,
      sample.luminanceVariance,
    );
    const change = previousPixels
      ? meanPixelChange(previousPixels, sample.pixels)
      : Number.POSITIVE_INFINITY;
    const detailed = sample.colorBins >= 40 && sample.luminanceVariance >= 120;
    stableSamples = detailed && change < 8 ? stableSamples + 1 : 0;
    if (stableSamples >= 2) return;
    previousPixels = sample.pixels;
  }
  if (allowUnsettled) {
    console.warn("Imagery did not fully settle before the capture window");
    return;
  }
  throw new Error(
    `Photorealistic imagery did not become detailed before capture (color bins ${bestColorBins}, luminance variance ${bestLuminanceVariance.toFixed(1)}). Retry or pass --allow-unsettled=true to override.`,
  );
}

function visualSample(image) {
  const png = PNG.sync.read(image);
  const colors = new Set();
  const luminance = [];
  const pixels = [];
  const stride = Math.max(12, Math.floor(Math.min(png.width, png.height) / 48));
  for (let y = 0; y < png.height; y += stride) {
    for (let x = 0; x < png.width; x += stride) {
      const index = (y * png.width + x) * 4;
      const red = png.data[index];
      const green = png.data[index + 1];
      const blue = png.data[index + 2];
      colors.add(`${red >> 4}:${green >> 4}:${blue >> 4}`);
      luminance.push(red * 0.2126 + green * 0.7152 + blue * 0.0722);
      pixels.push(red, green, blue);
    }
  }
  const mean =
    luminance.reduce((total, value) => total + value, 0) / luminance.length;
  const luminanceVariance =
    luminance.reduce((total, value) => total + (value - mean) ** 2, 0) /
    luminance.length;
  return {
    colorBins: colors.size,
    luminanceVariance,
    pixels,
  };
}

function meanPixelChange(previous, current) {
  if (previous.length !== current.length) return Number.POSITIVE_INFINITY;
  let difference = 0;
  for (let index = 0; index < current.length; index += 1) {
    difference += Math.abs(previous[index] - current[index]);
  }
  return difference / current.length;
}

function timelineVolumeExpression(timeline, volumes) {
  return timeline.reduceRight(
    (next, shot) =>
      `if(lt(t\\,${shot.endSeconds.toFixed(3)})\\,${volumes[shot.kind] ?? 0.01}\\,${next})`,
    "0.01",
  );
}
