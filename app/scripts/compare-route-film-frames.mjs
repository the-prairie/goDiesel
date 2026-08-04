import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  comparePngBuffers,
  rendererPromotionDecision,
} from "./route-film-frame-comparison.mjs";

function argument(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

const manifestPath = resolve(argument("manifest", ""));
const browserDirectory = resolve(argument("browser-dir", ""));
const unrealDirectory = resolve(argument("unreal-dir", ""));
const repeatedRuns = Number(argument("repeated-runs", "0"));
const reportPath = resolve(argument("report", "artifacts/route-films/comparison.json"));

if (!argument("manifest", "") || !argument("browser-dir", "") || !argument("unreal-dir", "")) {
  throw new Error("--manifest, --browser-dir, and --unreal-dir are required");
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const comparisons = [];
for (const frame of manifest.comparison.frames) {
  const filename = `${String(frame).padStart(6, "0")}.png`;
  const [browser, unreal] = await Promise.all([
    readFile(resolve(browserDirectory, filename)),
    readFile(resolve(unrealDirectory, filename)),
  ]);
  comparisons.push({
    frame,
    filename,
    ...comparePngBuffers(browser, unreal),
  });
}

const report = {
  contract: manifest.contract,
  route: manifest.route.slug,
  repeatedRuns,
  comparisons,
  decision: rendererPromotionDecision({ comparisons, repeatedRuns }),
};
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
