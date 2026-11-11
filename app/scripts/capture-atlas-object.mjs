import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const base = process.env.ATLAS_URL ?? "http://127.0.0.1:8787";
const out = "/workspace/app/e2e/evidence/atlas-mobile-round-3";

function open(layoutParams = "") {
  return `${base}/#/atlas?atlasLayout=g${layoutParams}`;
}

async function globeLit(page) {
  await page.waitForFunction(() => {
    const canvas = document.querySelector("canvas[data-atlas-engine='cesium']");
    return canvas?.dataset.cameraState === "settled" && Number(canvas.dataset.cameraHeight) > 5_000_000;
  }, { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await page.getByTestId("atlas-object-tune").waitFor({ timeout: 8000 }).catch(() => {});
}

const browser = await chromium.launch({
  channel: "chrome",
  args: ["--use-gl=angle", "--use-angle=swiftshader"],
});
await mkdir(out, { recursive: true });

const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  recordVideo: { dir: `${out}/video`, size: { width: 390, height: 844 } },
});
const page = await context.newPage();
const notes = [];

await page.goto(open(), { waitUntil: "domcontentloaded" });
await page.reload({ waitUntil: "domcontentloaded" });
await globeLit(page);
await page.screenshot({ path: `${out}/g-night.png` });
await page.screenshot({ path: `${out}/g-tune.png` });
notes.push("night");

notes.push("night and tune");

await page.goto(open(`&region=${encodeURIComponent("Crete, Greece")}`), { waitUntil: "domcontentloaded" });
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector("[data-map-status='ready']", { timeout: 35000 });
await page.waitForTimeout(1000);
await page.screenshot({ path: `${out}/g-arrival.png` });
await page.screenshot({ path: `${out}/g-ghosts.png` });
notes.push("arrival");

const ghost = page.getByRole("button", { name: /Focus 2024-12-27/ });
if (await ghost.count()) {
  await ghost.click();
  await page.getByTestId("atlas-object-focus").waitFor({ timeout: 8000 });
  await page.screenshot({ path: `${out}/g-focus.png` });
  notes.push("focus");
} else {
  notes.push("focus missing");
}

const video = page.video();
await context.close();

const reduced = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  reducedMotion: "reduce",
});
const still = await reduced.newPage();
await still.goto(open(), { waitUntil: "domcontentloaded" });
await still.reload({ waitUntil: "domcontentloaded" });
await globeLit(still);
await still.screenshot({ path: `${out}/g-reduced.png` });
notes.push("reduced");
await reduced.close();
await browser.close();
if (video) notes.push(await video.path());
console.log(notes.join("\n"));
