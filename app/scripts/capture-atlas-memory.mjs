import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const base = process.env.ATLAS_URL ?? "http://127.0.0.1:8787";
const out = process.env.ATLAS_SHOTS ?? "/workspace/app/e2e/evidence/atlas-mobile-round-2";

function url(layout, params = {}) {
  const search = new URLSearchParams({ atlasLayout: layout, ...params });
  return `${base}/#/atlas?${search.toString()}`;
}

async function settleGlobe(page) {
  await page.getByLabel("Search places and routes").waitFor({ timeout: 20000 }).catch(() => {});
  await page.waitForFunction(() => {
    const canvas = document.querySelector("canvas[data-atlas-engine='cesium']");
    return canvas?.dataset.cameraState === "settled" || canvas?.dataset.atlasState === "global";
  }, { timeout: 25000 }).catch(() => {});
  await page.getByRole("button", { name: /Crete, Greece/ }).waitFor({ timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(800);
}

async function settleRegion(page) {
  await page.waitForSelector("[data-map-status='ready'], [data-atlas-state='region-ready']", { timeout: 35000 }).catch(() => {});
  await page.waitForTimeout(1200);
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

await page.goto(url("d"), { waitUntil: "domcontentloaded" });
await page.reload({ waitUntil: "domcontentloaded" });
await settleGlobe(page);
await page.screenshot({ path: `${out}/d-planet.png` });
notes.push("d planet");

await page.getByRole("button", { name: "Hold" }).click();
await page.waitForTimeout(400);
await page.getByRole("button", { name: "Select Crete, Greece on globe" }).click();
await page.getByTestId("atlas-memory-arrival").waitFor({ timeout: 20000 });
await settleRegion(page);
await page.screenshot({ path: `${out}/d-crete.png` });
notes.push("d crete");

await page.getByTestId("atlas-memory-find").click();
await page.getByTestId("atlas-memory-search").waitFor();
await page.screenshot({ path: `${out}/d-find.png` });
notes.push("d find");

await page.goto(url("e"), { waitUntil: "domcontentloaded" });
await page.reload({ waitUntil: "domcontentloaded" });
await settleGlobe(page);
await page.getByTestId("atlas-memory-year").waitFor();
await page.screenshot({ path: `${out}/e-2025.png` });
notes.push("e 2025");

await page.getByRole("button", { name: "2024", exact: true }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/e-2024.png` });
notes.push("e 2024");

await page.getByRole("button", { name: /Crete, Greece/ }).first().click();
await settleRegion(page);
await page.screenshot({ path: `${out}/e-crete.png` });
notes.push("e crete");

await page.goto(url("f"), { waitUntil: "domcontentloaded" });
await page.reload({ waitUntil: "domcontentloaded" });
await page.getByTestId("atlas-memory-chapter").waitFor({ timeout: 20000 });
await settleRegion(page);
await page.screenshot({ path: `${out}/f-open.png` });
notes.push("f open");

await page.getByRole("button", { name: "Next place" }).click();
await settleRegion(page);
await page.screenshot({ path: `${out}/f-next.png` });
notes.push("f next");

await page.goto(url("f", { region: "Crete, Greece" }), { waitUntil: "domcontentloaded" });
await page.reload({ waitUntil: "domcontentloaded" });
await page.getByTestId("atlas-memory-chapter").waitFor({ timeout: 20000 });
await settleRegion(page);
await page.screenshot({ path: `${out}/f-crete.png` });
notes.push("f crete");

const video = page.video();
await context.close();
if (video) {
  const saved = await video.path();
  notes.push(`video ${saved}`);
}
await browser.close();
console.log(notes.join("\n"));
