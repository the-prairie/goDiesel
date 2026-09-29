/**
 * Runtime measurement for Replay with and without the adventure layer, on a
 * production build (`npm run build && npm run preview`), in a real browser.
 *
 * Each run uses a fresh browser context, so the HTTP cache starts empty
 * (provider tiles included). Reports time to ready, then frame intervals and
 * long tasks over a fixed stretch of playback, and writes one Chrome trace
 * per scenario. It records what it observes; it sets no targets.
 *
 *   BASE=http://localhost:8790 PW_CHROMIUM=<Chrome for Testing> node scripts/measure-adventure-runtime.mjs
 *   SCENARIOS=notebook-adventure,notebook-plain   (optional subset)
 *   TRACE=1   (also write one gzipped Chrome trace per scenario)
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import zlib from "node:zlib";

const BASE = process.env.BASE ?? "http://localhost:8790";
const OUT = process.env.OUT ?? "../.godiesel/evidence/adventure-runtime";
const PLAY_SECONDS = Number(process.env.PLAY_SECONDS ?? 8);
fs.mkdirSync(OUT, { recursive: true });

const WITH = "14130782031";
const WITHOUT = "14130768855";
const scenarios = [
  { id: "notebook-adventure", path: `/#/replay/${WITH}?landscape=notebook`, runs: 3 },
  { id: "notebook-plain", path: `/#/replay/${WITHOUT}?landscape=notebook`, runs: 3 },
  { id: "notebook-film-route-beat", path: `/#/replay/${WITH}?landscape=notebook`, runs: 3, film: true },
  { id: "google-adventure", path: `/#/replay/${WITH}`, runs: 2, live: true },
  { id: "google-plain", path: `/#/replay/${WITHOUT}`, runs: 2, live: true },
].filter((scenario) => !process.env.SCENARIOS || process.env.SCENARIOS.split(",").includes(scenario.id));

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const renderer = await (async () => {
  const page = await browser.newPage();
  const value = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    return gl?.getParameter(gl.getExtension("WEBGL_debug_renderer_info")?.UNMASKED_RENDERER_WEBGL ?? 0x1f01) ?? "no WebGL";
  });
  await page.close();
  return value;
})();

const median = (values) => {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null;
};

async function run(scenario, index) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error).slice(0, 120)));
  // Traces run to hundreds of megabytes each; opt in, and they are gzipped.
  const trace = index === 0 && process.env.TRACE === "1";
  if (trace) await browser.startTracing(page, { path: `${OUT}/${scenario.id}.trace.json`, screenshots: false });
  await page.goto(BASE + scenario.path, { waitUntil: "load" });
  const loaded = await page.evaluate(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const stage = () => document.querySelector("[data-testid='replay-stage']");
    const started = Date.now();
    while (!["ready", "partial", "unavailable"].includes(stage()?.dataset.state) && Date.now() - started < 60_000) await wait(25);
    const readyMs = performance.now();
    let cardMs = null;
    const cardStarted = Date.now();
    while (!document.querySelector("[data-testid='adventure-chapter-card']") && Date.now() - cardStarted < 2_500) await wait(20);
    if (document.querySelector("[data-testid='adventure-chapter-card']")) cardMs = performance.now();
    return { state: stage()?.dataset.state, readyMs, cardMs };
  });
  await page.waitForTimeout(1_000);
  if (scenario.film) {
    await page.getByRole("button", { name: "All chapters" }).click();
    await page.locator("#adventure-chapter-list").getByRole("button", { name: /\d:\d\d/ }).click();
    await page.waitForFunction(() => document.querySelector("[data-testid='adventure-film']")?.getAttribute("data-beat-kind") === "route", null, { timeout: 30_000 });
  } else {
    await page.getByRole("button", { name: "Play route" }).click();
  }
  const sample = await page.evaluate(async (seconds) => {
    const longTasks = [];
    const observer = new PerformanceObserver((list) => list.getEntries().forEach((entry) => longTasks.push(entry.duration)));
    try { observer.observe({ type: "longtask", buffered: false }); } catch { /* unsupported */ }
    const frames = [];
    let last = performance.now();
    const end = last + seconds * 1_000;
    await new Promise((resolve) => {
      const tick = (now) => {
        frames.push(now - last);
        last = now;
        if (now < end) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    observer.disconnect();
    const sorted = [...frames].sort((a, b) => a - b);
    const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
    return {
      frames: frames.length,
      p50: q(0.5),
      p95: q(0.95),
      max: sorted.at(-1),
      over50: frames.filter((frame) => frame > 50).length,
      longTasks: longTasks.length,
      longestLongTask: Math.max(0, ...longTasks),
    };
  }, scenario.film ? Math.min(PLAY_SECONDS, 3.5) : PLAY_SECONDS);
  if (trace) {
    await browser.stopTracing();
    const file = `${OUT}/${scenario.id}.trace.json`;
    fs.writeFileSync(`${file}.gz`, zlib.gzipSync(fs.readFileSync(file), { level: 9 }));
    fs.rmSync(file);
  }
  await context.close();
  return { ...loaded, ...sample, errors: errors.length };
}

const results = [];
for (const scenario of scenarios) {
  const runs = [];
  for (let index = 0; index < scenario.runs; index += 1) runs.push(await run(scenario, index));
  const summary = {
    scenario: scenario.id,
    live: Boolean(scenario.live),
    runs: runs.length,
    states: [...new Set(runs.map((item) => item.state))].join(","),
    readyMs: Math.round(median(runs.map((item) => item.readyMs))),
    cardAfterReadyMs: runs.every((item) => item.cardMs === null) ? null : Math.round(median(runs.map((item) => item.cardMs - item.readyMs))),
    frameP50Ms: +median(runs.map((item) => item.p50)).toFixed(1),
    frameP95Ms: +median(runs.map((item) => item.p95)).toFixed(1),
    frameMaxMs: +median(runs.map((item) => item.max)).toFixed(1),
    framesOver50Ms: median(runs.map((item) => item.over50)),
    longTasks: median(runs.map((item) => item.longTasks)),
    longestLongTaskMs: Math.round(median(runs.map((item) => item.longestLongTask))),
    pageErrors: runs.reduce((sum, item) => sum + item.errors, 0),
  };
  results.push({ ...summary, raw: runs });
  console.log(JSON.stringify(summary));
}
await browser.close();
const environment = {
  at: new Date().toISOString(),
  base: BASE,
  build: "vite build + vite preview (production bundle)",
  browser: "Chrome for Testing, headless",
  renderer,
  viewport: "1440x900 @1x",
  cache: "fresh context per run: empty HTTP cache, provider tiles fetched over the network",
  playSeconds: PLAY_SECONDS,
};
fs.writeFileSync(`${OUT}/result.json`, JSON.stringify({ environment, results }, null, 2));
console.log(JSON.stringify(environment));
