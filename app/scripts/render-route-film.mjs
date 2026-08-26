import { spawn } from "node:child_process";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";

import { chromium } from "playwright";
import { PNG } from "pngjs";
import routeExperienceVersion from "../src/surfaces/replay/cinematic/route-experience-version.json" with { type: "json" };

import {
  createExportManifest,
  createFramePlan,
  DEFAULT_STABILITY_POLICY,
  evaluateVisualQuality,
  evaluateVisualStability,
  exportFingerprint,
  resumeFrameIndex,
  sampleVisualGrid,
  timelineVolumeExpression,
  visualSample,
} from "./route-film-export.mjs";

function argument(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

const slug = argument("route", "14023448720");
const filmUrlOverride = argument("film-url", "");
const sourceFingerprint = argument("source-fingerprint", "");
const expectedManifestVersion = Number(argument("manifest-version", String(routeExperienceVersion.manifestVersion)));
const expectedDirectorVersion = Number(argument("director-version", String(routeExperienceVersion.directorVersion)));
const cut = argument("cut", "feature");
const baseUrl = argument("base-url", "http://127.0.0.1:8787");
const width = Number(argument("width", "3840"));
const height = Number(argument("height", "2160"));
const fps = Number(argument("fps", "24"));
const motionSamples = Number(argument("motion-samples", "1"));
const spatialScale = Number(argument("spatial-scale", "1"));
const maxSeconds = Number(argument("max-seconds", "0"));
const preflight = argument("preflight", "true") !== "false";
const allowUnsettled = argument("allow-unsettled", "false") === "true";
const keepFrames = argument("keep-frames", "false") === "true";
const resume = argument("resume", "true") !== "false";
const proxy = argument("proxy", "true") !== "false";
const settleAttempts = Number(argument("settle-attempts", "12"));
const settleDelayMs = Number(argument("settle-delay-ms", "180"));
const output = resolve(
  argument(
    "output",
    `artifacts/route-films/${slug}-${cut}-4k-prores.mov`,
  ),
);
const frameDirectory = resolve(
  argument("frame-dir", `${output}.frames`),
);
const manifestPath = join(frameDirectory, "manifest.json");
const reportPath = resolve(argument("report", `${output}.report.json`));
const headed = process.argv.includes("--headed");

if (
  !["feature", "monumental", "kinetic", "intimate"].includes(cut) ||
  !Number.isFinite(width) ||
  !Number.isFinite(height) ||
  !Number.isFinite(fps) ||
  !Number.isFinite(maxSeconds) ||
  !Number.isFinite(motionSamples) ||
  !Number.isFinite(spatialScale) ||
  !Number.isFinite(settleAttempts) ||
  !Number.isFinite(settleDelayMs) ||
  width < 640 ||
  height < 360 ||
  fps < 1 ||
  maxSeconds < 0 ||
  motionSamples < 1 ||
  motionSamples > 4 ||
  !Number.isInteger(motionSamples) ||
  spatialScale < 1 ||
  spatialScale > 2 ||
  settleAttempts < 3 ||
  settleDelayMs < 50
) {
  throw new Error(
    "cut, dimensions, fps, motion-samples (1-4), spatial-scale (1-2), and settling values must be valid",
  );
}

await mkdir(dirname(output), { recursive: true });
await mkdir(dirname(reportPath), { recursive: true });

const captureFps = fps * motionSamples;
const captureWidth = Math.round(width * spatialScale);
const captureHeight = Math.round(height * spatialScale);
const browser = await chromium.launch({
  headless: !headed,
  args: ["--enable-webgl", "--ignore-gpu-blocklist", "--use-angle=metal"],
});
const page = await browser.newPage({
  deviceScaleFactor: 1,
  viewport: { width: captureWidth, height: captureHeight },
});

let manifest;
let completedSuccessfully = false;
try {
  const filmUrl = filmUrlOverride || `${baseUrl}/#/lab/cinematic-director/${slug}?render=1&cut=${cut}`;
  console.log(`Staging ${filmUrl}`);
  console.log(
    `Preparing deterministic ${width}x${height} master at ${fps} fps from ${captureWidth}x${captureHeight}`,
  );
  await page.goto(filmUrl, { waitUntil: "domcontentloaded" });
  const film = page.locator("[data-route-film]");
  await film.waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForFunction(
    () => {
      const state = document
        .querySelector("[data-route-film]")
        ?.getAttribute("data-state");
      return state === "ready" || state === "unavailable";
    },
    undefined,
    { timeout: 30_000 },
  );
  const providerState = await film.getAttribute("data-state");
  if (providerState !== "ready") {
    const message = await film.getByRole("alert").textContent().catch(() => "");
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
  const filmKind = (await film.getAttribute("data-route-film")) ?? "feature";
  const manifestVersion = Number(await film.getAttribute("data-manifest-version"));
  const directorVersion = Number(await film.getAttribute("data-director-version"));
  if (manifestVersion !== expectedManifestVersion || directorVersion !== expectedDirectorVersion) {
    throw new Error(`Route film version mismatch: expected ${expectedManifestVersion}/${expectedDirectorVersion}, received ${manifestVersion}/${directorVersion}`);
  }
  const durationSeconds =
    maxSeconds > 0
      ? Math.min(maxSeconds, completeDuration)
      : completeDuration;

  if (
    shotTimeline.length !== shotCount ||
    shotTimeline.some(
      (shot) =>
        !Number.isFinite(shot.startSeconds) ||
        !Number.isFinite(shot.endSeconds) ||
        shot.endSeconds <= shot.startSeconds,
    )
  ) {
    throw new Error("The route film did not expose a valid shot timeline");
  }

  const configuration = {
    allowUnsettled,
    captureHeight,
    captureWidth,
    cut,
    durationSeconds,
    fps,
    filmKind,
    height,
    manifestVersion,
    motionSamples,
    qualityPolicyVersion: 1,
    route: slug,
    sourceFingerprint,
    directorVersion,
    settleAttempts,
    settleDelayMs,
    spatialScale,
    stabilityPolicyVersion: 1,
    width,
  };
  const framePlan = createFramePlan({
    durationSeconds,
    fps,
    motionSamples,
  });
  manifest = await prepareManifest({
    configuration,
    frameDirectory,
    framePlan,
    manifestPath,
    resume,
  });

  await seekFilm(page, Math.min(1.2, completeDuration * 0.08));
  await settleFrame(page, {
    allowUnsettled,
    attempts: settleAttempts,
    delayMs: Math.max(250, settleDelayMs),
  });
  await seekFilm(page, 0);

  if (preflight) {
    console.log(
      `Preflighting ${shotCount} acts at entrance, hero, and exit in the final ${captureWidth}x${captureHeight} viewport`,
    );
    for (const shot of shotTimeline) {
      for (const position of [0.08, 0.5, 0.92]) {
        const seconds =
          shot.startSeconds +
          (shot.endSeconds - shot.startSeconds) * position;
        await seekFilm(page, Math.min(durationSeconds, seconds));
        await settleFrame(page, {
          allowUnsettled,
          attempts: settleAttempts,
          delayMs: Math.max(220, settleDelayMs),
        });
      }
    }
    await seekFilm(page, 0);
  }

  await seekFilm(page, durationSeconds);
  if (durationSeconds === completeDuration && (await film.getAttribute("data-decision-frame")) !== "true") {
    throw new Error("The complete route teaser did not end on its decision frame");
  }
  await seekFilm(page, 0);

  const existingFiles = new Set(await readdir(frameDirectory));
  const startFrame = resumeFrameIndex(manifest, framePlan, existingFiles);
  if (startFrame > 0) {
    console.log(`Resuming after ${startFrame} verified lossless frames`);
  }

  let previousChapter;
  for (const frame of framePlan.slice(startFrame)) {
    await seekFilm(page, frame.seconds);
    const chapter = await film.getAttribute("data-chapter");
    const shotKind = await film.getAttribute("data-shot-kind");
    const stability = await settleFrame(page, {
      allowUnsettled,
      attempts: settleAttempts,
      delayMs:
        chapter !== previousChapter
          ? Math.max(250, settleDelayMs)
          : settleDelayMs,
    });
    previousChapter = chapter;

    const path = join(frameDirectory, frame.filename);
    await page.screenshot({
      animations: "disabled",
      path,
      type: "png",
    });
    const evidence = {
      ...stability,
      chapter,
      capturedAt: new Date().toISOString(),
      seconds: frame.seconds,
      shotKind,
    };
    manifest.completedFrames[frame.index] = evidence;
    manifest.lastCompletedFrame = frame.index;
    manifest.updatedAt = evidence.capturedAt;
    await writeJsonAtomic(manifestPath, manifest);

    if (frame.index % captureFps === 0) {
      console.log(
        `Verified ${Math.min(durationSeconds, frame.seconds).toFixed(0)}s / ${durationSeconds.toFixed(0)}s`,
      );
    }
  }

  const masterCodec = extname(output).toLowerCase() === ".mov" ? "prores" : "h264";
  console.log(
    `Encoding ${masterCodec === "prores" ? "ProRes 422 HQ" : "H.264"} master from ${framePlan.length} verified PNG frames`,
  );
  await encodeMaster({
    captureFps,
    durationSeconds,
    fps,
    frameDirectory,
    height,
    masterCodec,
    motionSamples,
    output,
    shotTimeline,
    terrainCharacter,
    width,
  });

  let proxyOutput;
  if (proxy && masterCodec === "prores") {
    proxyOutput = output.replace(/\.mov$/i, ".mp4");
    console.log(`Encoding viewing proxy ${proxyOutput}`);
    await encodeProxy(output, proxyOutput);
  }

  manifest.status = "complete";
  manifest.completedAt = new Date().toISOString();
  manifest.master = {
    bytes: (await stat(output)).size,
    codec: masterCodec,
    path: output,
  };
  manifest.proxy = proxyOutput
    ? {
        bytes: (await stat(proxyOutput)).size,
        codec: "h264",
        path: proxyOutput,
      }
    : undefined;
  await writeJsonAtomic(manifestPath, manifest);
  await writeJsonAtomic(reportPath, {
    ...manifest,
    completedFrames: Object.values(manifest.completedFrames),
  });
  completedSuccessfully = true;
  console.log(`Route Film master written to ${output}`);
  console.log(`Render evidence written to ${reportPath}`);
} finally {
  await browser.close();
  if (completedSuccessfully && !keepFrames) {
    await rm(frameDirectory, { force: true, recursive: true });
  }
}

async function prepareManifest({
  configuration,
  frameDirectory,
  framePlan,
  manifestPath,
  resume,
}) {
  await mkdir(frameDirectory, { recursive: true });
  if (resume) {
    try {
      const existing = JSON.parse(await readFile(manifestPath, "utf8"));
      if (existing.fingerprint === exportFingerprint(configuration)) {
        return existing;
      }
      console.log("Existing frame cache uses different render settings; starting clean");
    } catch {
      // A missing or incomplete manifest starts a new render.
    }
  }
  await rm(frameDirectory, { force: true, recursive: true });
  await mkdir(frameDirectory, { recursive: true });
  const next = createExportManifest(configuration, framePlan);
  await writeJsonAtomic(manifestPath, next);
  return next;
}

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
        .querySelector("[data-route-film]")
        ?.getAttribute("data-frame-seconds");
      if (value !== null && Math.abs(Number(value) - time) < 0.01) return true;
      window.dispatchEvent(
        new CustomEvent("godiesel:route-film-seek", {
          detail: { seconds: time },
        }),
      );
      return false;
    },
    seconds,
    { polling: 100, timeout: 30_000 },
  );
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
}

async function settleFrame(
  page,
  {
    allowUnsettled = false,
    attempts = 12,
    delayMs = 180,
    policy = DEFAULT_STABILITY_POLICY,
  } = {},
) {
  const samples = [];
  let finalImage;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await page.waitForTimeout(delayMs);
    const image = await captureUngradedWorld(page);
    finalImage = image;
    samples.push(visualSample(image));
    const result = evaluateVisualStability(samples, policy);
    if (result.stable) {
      const visualQuality = evaluateVisualQuality(
        sampleVisualGrid(PNG.sync.read(image)),
      );
      if (!visualQuality.accepted) {
        throw new Error(
          `Stable imagery failed visual quality with score ${visualQuality.score}: ${visualQuality.findings.join(", ") || "unspecified artifact"}.`,
        );
      }
      return {
        ...result,
        attempts: attempt + 1,
        settled: true,
        visualQuality,
      };
    }
  }

  const result = evaluateVisualStability(samples, policy);
  if (allowUnsettled) {
    const visualQuality = evaluateVisualQuality(
      sampleVisualGrid(PNG.sync.read(finalImage)),
    );
    if (!visualQuality.accepted) {
      throw new Error(
        `Unsettled imagery failed visual quality with score ${visualQuality.score}: ${visualQuality.findings.join(", ") || "unspecified artifact"}.`,
      );
    }
    console.warn(
      `Capturing unsettled imagery after ${attempts} checks (change ${result.finalMeanPixelChange.toFixed(2)})`,
    );
    return {
      ...result,
      attempts,
      settled: false,
      visualQuality,
    };
  }
  throw new Error(
    `Visible imagery did not stabilize after ${attempts} checks: color bins ${result.bestColorBins}, luminance variance ${result.bestLuminanceVariance.toFixed(1)}, pixel change ${result.finalMeanPixelChange.toFixed(2)}. The frame was not captured.`,
  );
}

async function captureUngradedWorld(page) {
  const world = page.getByTestId("cinematic-world");
  const source = page.locator("gmp-map-3d");
  const presentation = await world.evaluate((element) => {
    const siblings = Array.from(element.parentElement?.children ?? []).filter(
      (candidate) => candidate !== element,
    );
    const previous = {
      filter: element.style.filter,
      siblingVisibility: siblings.map((sibling) => sibling.style.visibility),
    };
    element.style.filter = "none";
    siblings.forEach((sibling) => {
      sibling.style.visibility = "hidden";
    });
    return previous;
  });
  try {
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    return await source.screenshot({
      animations: "disabled",
      type: "png",
    });
  } finally {
    await world.evaluate((element, previous) => {
      element.style.filter = previous.filter;
      const siblings = Array.from(element.parentElement?.children ?? []).filter(
        (candidate) => candidate !== element,
      );
      siblings.forEach((sibling, index) => {
        sibling.style.visibility = previous.siblingVisibility[index] ?? "";
      });
    }, presentation);
  }
}

async function encodeMaster({
  captureFps,
  durationSeconds,
  fps,
  frameDirectory,
  height,
  masterCodec,
  motionSamples,
  output,
  shotTimeline,
  terrainCharacter,
  width,
}) {
  const fadeOutStart = Math.max(0, durationSeconds - 2);
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
  const videoCodecArguments =
    masterCodec === "prores"
      ? [
          "-c:v",
          "prores_ks",
          "-profile:v",
          "3",
          "-pix_fmt",
          "yuv422p10le",
          "-vendor",
          "apl0",
        ]
      : [
          "-c:v",
          "libx264",
          "-preset",
          "slow",
          "-crf",
          "15",
          "-pix_fmt",
          "yuv420p",
          "-movflags",
          "+faststart",
        ];

  await runProcess("ffmpeg", [
    "-y",
    "-framerate",
    String(captureFps),
    "-start_number",
    "0",
    "-i",
    join(frameDirectory, "frame-%06d.png"),
    "-f",
    "lavfi",
    "-i",
    `anoisesrc=color=pink:amplitude=0.018:seed=424242:duration=${durationSeconds}`,
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=48:sample_rate=48000:duration=${durationSeconds}`,
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${scoreFrequencies[0]}:sample_rate=48000:duration=${durationSeconds}`,
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${scoreFrequencies[2]}:sample_rate=48000:duration=${durationSeconds}`,
    "-filter_complex",
    audioFilter,
    "-vf",
    videoFilter,
    "-map",
    "0:v",
    "-map",
    "[a]",
    ...videoCodecArguments,
    "-c:a",
    "aac",
    "-b:a",
    "256k",
    "-shortest",
    output,
  ]);
}

async function encodeProxy(master, output) {
  await runProcess("ffmpeg", [
    "-y",
    "-i",
    master,
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "17",
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

async function runProcess(command, arguments_) {
  const child = spawn(command, arguments_, {
    stdio: ["ignore", "inherit", "inherit"],
  });
  const exitCode = await new Promise((resolve) =>
    child.once("close", resolve),
  );
  if (exitCode !== 0) {
    throw new Error(`${command} exited with code ${exitCode}`);
  }
}

async function writeJsonAtomic(path, value) {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
}
