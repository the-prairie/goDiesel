/**
 * Journal paint-order regression measurement.
 *
 * The guarantee this protects is an ordering, not a stopwatch time: on a cold
 * load the recorded route must be on screen before the basemap tiles arrive,
 * so you never sit looking at a place without your line on it. Wall-clock
 * numbers move with the machine and the network; the order does not.
 *
 * Three unambiguous milestones, sampled from the map canvas itself:
 *
 *   groundPaint  first frame where the canvas has painted anything at all
 *                (the style's ground colour, before any tile has decoded)
 *   routePaint   first frame containing the route's own line
 *   tilePaint    first frame containing basemap tile content
 *                (water or vegetation, which only exist in decoded tiles)
 *
 * Usage:
 *   npm run dev            # or vite preview
 *   npm run perf:journal-paint [-- --base=http://localhost:8787]
 *
 * Needs network access for the basemap style and tiles, so it is not part of
 * the default test run.
 */
import { chromium } from "@playwright/test";

const args = new Map(
  process.argv
    .slice(2)
    .filter((arg) => arg.startsWith("--"))
    .map((arg) => {
      const [key, ...rest] = arg.replace(/^--/, "").split("=");
      return [key, rest.join("=") || "true"];
    }),
);

const BASE = args.get("base") ?? "http://localhost:8787";
const SETTLE_MS = Number(args.get("settle") ?? 12000);
const SAMPLE_MS = 20;

/** Budget on the gap, generous enough not to become a flake. */
const GROUND_TO_ROUTE_BUDGET_MS = Number(args.get("budget") ?? 600);

const CRETE = encodeURIComponent("Crete, Greece");
const BANFF = encodeURIComponent("Banff/Kananaskis");

const CASES = [
  ["cold atlas", `/#/lab/design-seeds/b/atlas?region=${CRETE}&route=14130782031&theme=journal`],
  ["cold day (note)", `/#/lab/design-seeds/b/story/14130782031?region=${CRETE}&theme=journal`],
  ["cold day (no note)", `/#/lab/design-seeds/b/story/15573295095?region=${BANFF}&theme=journal`],
];

/**
 * Runs in the page. Copies the WebGL canvas into a small 2d canvas and
 * classifies pixels; `preserveDrawingBuffer` is already on for this workspace,
 * which is what makes reading the buffer possible at all.
 */
const SAMPLER = (sampleMs) => `
(() => {
  const out = [];
  const scratch = document.createElement('canvas');
  const ctx = scratch.getContext('2d', { willReadFrequently: true });
  const tick = () => {
    const canvas = document.querySelector('canvas.maplibregl-canvas');
    const at = Math.round(performance.now());
    if (!canvas || !canvas.width) { out.push({ at, ground: 0, route: 0, tile: 0 }); return; }
    const w = 240;
    const h = Math.max(1, Math.round(canvas.height * w / canvas.width));
    scratch.width = w; scratch.height = h;
    try { ctx.drawImage(canvas, 0, 0, w, h); } catch { return; }
    const data = ctx.getImageData(0, 0, w, h).data;
    let ground = 0, route = 0, tile = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a < 8) continue;
      ground++;
      if (r > 140 && r - g > 55 && r - b > 55) route++;
      else if (b > g && g > r && b > 80 && b < 160) tile++;
      else if (g > r && g > b && g > 110 && g < 190) tile++;
    }
    out.push({ at, ground, route, tile });
  };
  window.__journalPaint = out;
  const id = setInterval(tick, ${sampleMs});
  setTimeout(() => clearInterval(id), 20000);
  tick();
})()`;

const browser = await chromium.launch();
const failures = [];

for (const [label, path] of CASES) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.addInitScript({
    content: `document.addEventListener('DOMContentLoaded', () => { ${SAMPLER(SAMPLE_MS)} });`,
  });
  await page.goto(BASE + path, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(SETTLE_MS);
  const samples = await page.evaluate(() => window.__journalPaint ?? []);
  await context.close();

  const at = (predicate) => samples.find(predicate)?.at;
  const groundPaint = at((s) => s.ground > 1000);
  const routePaint = at((s) => s.route > 40);
  const tilePaint = at((s) => s.tile > 400);

  const gap =
    groundPaint !== undefined && routePaint !== undefined ? routePaint - groundPaint : undefined;

  console.log(`\n${label}`);
  console.log(`  groundPaint : ${groundPaint ?? "never"} ms`);
  console.log(`  routePaint  : ${routePaint ?? "never"} ms`);
  console.log(`  tilePaint   : ${tilePaint ?? "never"} ms`);
  console.log(`  ground -> route gap: ${gap ?? "n/a"} ms (budget ${GROUND_TO_ROUTE_BUDGET_MS} ms)`);

  if (routePaint === undefined) {
    failures.push(`${label}: the route never painted`);
    continue;
  }
  if (groundPaint === undefined) {
    failures.push(`${label}: the canvas never painted`);
    continue;
  }
  if (gap > GROUND_TO_ROUTE_BUDGET_MS) {
    failures.push(`${label}: ground -> route gap ${gap} ms exceeds ${GROUND_TO_ROUTE_BUDGET_MS} ms`);
  }
  if (tilePaint !== undefined && routePaint > tilePaint) {
    failures.push(
      `${label}: basemap tiles painted at ${tilePaint} ms before the route at ${routePaint} ms - route-first behaviour has regressed`,
    );
  }
}

await browser.close();

if (failures.length) {
  console.error(`\nJournal paint order FAILED:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log("\nJournal paint order passed: the route is on screen before the basemap tiles.");
