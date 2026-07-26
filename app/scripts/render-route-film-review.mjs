import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { chromium } from "playwright";
import { PNG } from "pngjs";

import {
  DEFAULT_STABILITY_POLICY,
  evaluateVisualQuality,
  evaluateVisualStability,
  sampleVisualGrid,
  visualSample,
} from "./route-film-export.mjs";
import {
  assertReviewPassed,
  createContactSheet,
  failedReviewEvidence,
  reviewFrameFailures,
  selectReviewFrames,
} from "./route-film-review.mjs";

function argument(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

const route = argument("route", "14023448720");
const cut = argument("cut", "feature");
const baseUrl = argument("base-url", "http://127.0.0.1:8787");
const width = Number(argument("width", "1920"));
const height = Number(argument("height", "1080"));
const settleAttempts = Number(argument("settle-attempts", "12"));
const settleDelayMs = Number(argument("settle-delay-ms", "180"));
const outputDirectory = resolve(
  argument("output-dir", `artifacts/route-film-reviews/${route}-${cut}`),
);
const contactSheetPath = resolve(
  argument("contact-sheet", join(outputDirectory, "contact-sheet.png")),
);
const evidencePath = resolve(
  argument("evidence", join(outputDirectory, "evidence.json")),
);
const headed = process.argv.includes("--headed");

if (
  !["feature", "monumental", "kinetic", "intimate"].includes(cut) ||
  !Number.isInteger(width) ||
  !Number.isInteger(height) ||
  !Number.isInteger(settleAttempts) ||
  !Number.isFinite(settleDelayMs) ||
  width < 640 ||
  height < 360 ||
  settleAttempts < 3 ||
  settleDelayMs < 50
) {
  throw new Error(
    "cut, dimensions, and settling values must be valid",
  );
}

await mkdir(outputDirectory, { recursive: true });
await mkdir(dirname(contactSheetPath), { recursive: true });
await mkdir(dirname(evidencePath), { recursive: true });
await unlink(contactSheetPath).catch((error) => {
  if (error.code !== "ENOENT") {
    throw error;
  }
});

const configuration = {
  baseUrl,
  cut,
  height,
  route,
  settleAttempts,
  settleDelayMs,
  stabilityPolicy: DEFAULT_STABILITY_POLICY,
  width,
};
const evidence = {
  configuration,
  createdAt: new Date().toISOString(),
  frames: [],
  status: "capturing",
  version: 1,
};

let browser;
try {
  browser = await chromium.launch({
    headless: !headed,
    args: ["--enable-webgl", "--ignore-gpu-blocklist", "--use-angle=metal"],
  });
  const page = await browser.newPage({
    deviceScaleFactor: 1,
    viewport: { height, width },
  });
  const filmUrl = `${baseUrl}/#/lab/cinematic-director/${route}?render=1&cut=${cut}`;
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
    throw new Error(
      `Photorealistic provider unavailable at ${baseUrl}: ${message || providerState}`,
    );
  }

  const shotTimeline = JSON.parse(
    (await film.getAttribute("data-shot-timeline")) ?? "[]",
  );
  const reviewFrames = selectReviewFrames(shotTimeline);
  evidence.timeline = shotTimeline;
  evidence.selection = reviewFrames;

  const images = [];
  for (const selection of reviewFrames) {
    console.log(
      `Reviewing sample ${selection.sampleIndex + 1} from act ${selection.actIndex + 1} at ${selection.seconds.toFixed(3)}s`,
    );
    await seekFilm(page, selection.seconds);
    const stability = await settleFrame(page, {
      attempts: settleAttempts,
      delayMs: settleDelayMs,
    });
    const image = await page.screenshot({
      animations: "disabled",
      type: "png",
    });
    const quality = stability.visualQuality;
    const path = join(outputDirectory, selection.filename);
    await writeFile(path, image);

    evidence.frames.push({
      ...selection,
      ...stability,
      chapter: await film.getAttribute("data-chapter"),
      path,
      quality,
      qualityPassed: quality.accepted,
      shotKind: await film.getAttribute("data-shot-kind"),
    });
    images.push(image);
  }

  assertReviewPassed(evidence.frames);
  await writeFile(contactSheetPath, createContactSheet(images));
  evidence.completedAt = new Date().toISOString();
  evidence.contactSheet = contactSheetPath;
  evidence.status = "passed";
  await writeJsonAtomic(evidencePath, evidence);
  console.log(`Review contact sheet written to ${contactSheetPath}`);
  console.log(`Review evidence written to ${evidencePath}`);
} catch (error) {
  await unlink(contactSheetPath).catch((unlinkError) => {
    if (unlinkError.code !== "ENOENT") {
      throw unlinkError;
    }
  });
  const failedEvidence = failedReviewEvidence(evidence, [
      error instanceof Error ? error.message : String(error),
      ...reviewFrameFailures(evidence.frames),
    ]);
  failedEvidence.completedAt = new Date().toISOString();
  await writeJsonAtomic(evidencePath, failedEvidence);
  throw error;
} finally {
  await browser?.close();
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
        .querySelector('[data-testid="cinematic-director"]')
        ?.getAttribute("data-frame-seconds");
      return value !== null && Math.abs(Number(value) - time) < 0.01;
    },
    seconds,
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
    attempts,
    delayMs,
    policy = DEFAULT_STABILITY_POLICY,
  },
) {
  const samples = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await page.waitForTimeout(delayMs);
    const image = await page.locator("gmp-map-3d").screenshot({
      animations: "disabled",
      type: "png",
    });
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
  throw new Error(
    `Visible imagery did not stabilize after ${attempts} checks: color bins ${result.bestColorBins}, luminance variance ${result.bestLuminanceVariance.toFixed(1)}, pixel change ${result.finalMeanPixelChange.toFixed(2)}. The review frame was not captured.`,
  );
}

async function writeJsonAtomic(path, value) {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
}
