import { chromium } from "@playwright/test";
import { mkdir, rename } from "node:fs/promises";

const base = process.env.ATLAS_URL ?? "http://127.0.0.1:8787";
const out = "/workspace/app/e2e/evidence/atlas-mobile-round-3";
const glArgs = [
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist",
  "--enable-webgl",
  "--disable-gpu-sandbox",
];

function open(layoutParams = "") {
  return `${base}/#/atlas?atlasLayout=g${layoutParams}`;
}

async function globeLit(page) {
  await page.waitForFunction(() => {
    const canvas = document.querySelector("canvas[data-atlas-engine='cesium']");
    return canvas?.dataset.cameraState === "settled" && Number(canvas.dataset.cameraHeight) > 5_000_000;
  }, { timeout: 25000 });
  await page.waitForTimeout(1800);
  await page.getByTestId("atlas-object-tune").waitFor({ timeout: 8000 });
}

async function litPixels(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector("[data-testid='atlas-object-earth']");
    if (!(canvas instanceof HTMLCanvasElement)) return 0;
    const sample = document.createElement("canvas");
    sample.width = 78;
    sample.height = 150;
    const context = sample.getContext("2d");
    if (!context) return 0;
    context.drawImage(canvas, 0, 0, sample.width, sample.height);
    const data = context.getImageData(0, 0, sample.width, sample.height).data;
    let bright = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index] + data[index + 1] + data[index + 2] > 36) bright += 1;
    }
    return bright;
  });
}

async function dragUntilPlaceChanges(page) {
  const tune = page.getByTestId("atlas-object-tune");
  const before = (await tune.innerText()).split("\n")[0];
  const box = await page.getByTestId("atlas-object-dial").boundingBox();
  if (!box) throw new Error("dial missing");
  const directions = [1, -1];
  for (const direction of directions) {
    const startX = box.x + box.width * 0.5;
    const startY = box.y + box.height * 0.48;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    for (let step = 1; step <= 14; step += 1) {
      await page.mouse.move(startX + direction * step * 22, startY, { steps: 2 });
      await page.waitForTimeout(30);
    }
    await page.mouse.up();
    const changed = await page.waitForFunction((start) => {
      const el = document.querySelector("[data-testid='atlas-object-tune']");
      return Boolean(el && !el.textContent?.startsWith(start));
    }, before, { timeout: 2500 }).then(() => true).catch(() => false);
    if (changed) return (await tune.innerText()).split("\n")[0];
  }
  throw new Error(`drag stayed on ${before}`);
}

const browser = await chromium.launch({ channel: "chrome", args: glArgs });
await mkdir(out, { recursive: true });
await mkdir(`${out}/video`, { recursive: true });

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
const bright = await litPixels(page);
notes.push(`night pixels ${bright}`);
if (bright < 80) throw new Error(`night earth did not paint (${bright} lit pixels)`);
await page.screenshot({ path: `${out}/g-night.png` });
const tuned = await dragUntilPlaceChanges(page);
notes.push(`tuned ${tuned}`);
await page.screenshot({ path: `${out}/g-tune.png` });
const light = await page.evaluate(() => document.querySelector(".atlas-layout")?.getAttribute("data-atlas-light"));
if (light === "orbit") {
  await page.getByTestId("atlas-object-tune").click({ force: true });
}
await page.waitForFunction(() => {
  const value = document.querySelector(".atlas-layout")?.getAttribute("data-atlas-light");
  return value === "diving" || value === "landed";
});
if (await page.evaluate(() => document.querySelector(".atlas-layout")?.getAttribute("data-atlas-light") === "diving")) {
  await page.waitForTimeout(500);
}
await page.screenshot({ path: `${out}/g-arrival.png` });
await page.waitForSelector("[data-ghost-thread]", { timeout: 20000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/g-ghosts.png` });
const ghost = page.getByRole("button", { name: /Focus / }).first();
await ghost.click({ force: true });
await page.getByTestId("atlas-object-focus").waitFor({ timeout: 8000 });
await page.screenshot({ path: `${out}/g-focus.png` });
await page.getByRole("button", { name: "All routes here" }).click();
await page.getByRole("button", { name: "Back to the night" }).click();
await page.getByTestId("atlas-object-tune").waitFor({ timeout: 8000 });
notes.push("back");

const video = page.video();
await context.close();
if (video) {
  const recorded = await video.path();
  await rename(recorded, `${out}/atlas-object-tour.webm`);
  notes.push("video");
}

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
console.log(notes.join("\n"));
