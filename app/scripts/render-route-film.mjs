import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { chromium } from "playwright";

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
const maxSeconds = Number(argument("max-seconds", "0"));
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
  width < 640 ||
  height < 360 ||
  fps < 1
) {
  throw new Error("width, height, and fps must be valid positive render values");
}

await mkdir(dirname(output), { recursive: true });

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
  viewport: { width, height },
});

const filmUrl = `${baseUrl}/#/lab/cinematic-director/${slug}?render=1`;
console.log(`Staging ${filmUrl}`);
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
const duration =
  maxSeconds > 0 ? Math.min(maxSeconds, completeDuration) : completeDuration;
const totalFrames = Math.ceil(duration * fps);
const fadeOutStart = Math.max(0, duration - 2);
const audioFilter = [
  "[1:a]lowpass=f=420,volume=0.15[wind]",
  "[2:a]lowpass=f=180,volume=0.045[pulse]",
  `[wind][pulse]amix=inputs=2:duration=shortest,afade=t=in:st=0:d=1.8,afade=t=out:st=${fadeOutStart}:d=2[a]`,
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
    String(fps),
    "-i",
    "pipe:0",
    "-f",
    "lavfi",
    "-i",
    `anoisesrc=color=pink:amplitude=0.018:duration=${duration}`,
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=48:sample_rate=48000:duration=${duration}`,
    "-filter_complex",
    audioFilter,
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
  const seconds = frameIndex / fps;
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

  const chapter = await film.getAttribute("data-chapter");
  if (chapter !== previousChapter) {
    previousChapter = chapter;
    await page.waitForTimeout(frameIndex === 0 ? 2_000 : 900);
  } else {
    await page.waitForTimeout(Math.max(18, 500 / fps));
  }

  const jpeg = await page.screenshot({
    animations: "disabled",
    quality: 96,
    type: "jpeg",
  });
  if (!ffmpeg.stdin.write(jpeg)) {
    await new Promise((done) => ffmpeg.stdin.once("drain", done));
  }
  if (frameIndex % fps === 0) {
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
