/**
 * Overview lines break where recordings have gaps (review finding 4).
 *
 * Opens the Direction D region overview and, for every neighbouring route,
 * compares the number of lines drawn with the segments its canonical detail
 * record's recorded discontinuities imply for the summary trace. Also checks
 * that the selected route is split the same way. Gaps come only from recorded
 * evidence; nothing is inferred from point spacing.
 *
 *   BASE=http://127.0.0.1:8789 node scripts/verify-relief-overview-gaps.mjs
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://127.0.0.1:8789";
const REGION = process.env.REGION ?? "Crete, Greece";
const SELECTED = process.env.SELECTED ?? "14130782031";
const manifest = JSON.parse(fs.readFileSync("src/data/generated/routes.manifest.json", "utf8"));
const routes = manifest.routes.filter((route) => route.region === REGION);

const crosses = (a, b, gaps) => gaps.some((gap) => (gap.start_d === gap.end_d ? a <= gap.start_d && b > gap.end_d : a < gap.end_d && b > gap.start_d));
const expectedSegments = (trace, gaps) => {
  let segments = 0, length = 0;
  for (let i = 0; i < trace.length; i += 1) {
    if (i > 0 && crosses(trace[i - 1][3], trace[i][3], gaps)) { if (length > 1) segments += 1; length = 0; }
    length += 1;
  }
  return segments + (length > 1 ? 1 : 0);
};

const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures.push(name);
};
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${BASE}/#/lab/design-seeds/d/atlas?region=${encodeURIComponent(REGION)}&route=${SELECTED}`, { waitUntil: "load" });
await page.waitForFunction(() => window.__reliefMap?.getSource("relief-history"), null, { timeout: 30_000 });
await page.waitForTimeout(6000);
const drawn = await page.evaluate(() => {
  const map = window.__reliefMap;
  const features = (id) => map.getSource(id).serialize().data.features;
  const bySlug = {};
  for (const feature of features("relief-history")) bySlug[feature.properties.slug] = (bySlug[feature.properties.slug] ?? 0) + 1;
  return { bySlug, selected: features("relief-route").length };
});
let bridgesPrevented = 0;
for (const route of routes) {
  const gaps = JSON.parse(fs.readFileSync(`public/data/routes/${route.slug}.json`, "utf8")).provenance.discontinuities;
  const expected = expectedSegments(route.trace, gaps);
  bridgesPrevented += Math.max(0, expected - 1);
  const actual = route.slug === SELECTED ? drawn.selected : drawn.bySlug[route.slug] ?? 0;
  check(`${route.slug}${route.slug === SELECTED ? " (selected)" : ""}: ${gaps.length} recorded gap(s)`, actual === expected, `${actual} line(s) drawn, ${expected} expected`);
}
console.log(`  --   recorded gaps now break ${bridgesPrevented} line(s) that previously bridged them`);
await browser.close();
console.log(failures.length ? `\n${failures.length} failed` : "\nall passed");
process.exit(failures.length ? 1 : 0);
