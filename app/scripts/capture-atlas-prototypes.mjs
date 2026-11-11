import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const base = process.env.ATLAS_URL ?? "http://127.0.0.1:8787";
const out = process.env.ATLAS_SHOTS ?? "/opt/cursor/artifacts";
const crete = "Crete, Greece";
const route = "14080158961";

const layouts = ["a", "b", "c"];

function atlasUrl(layout, params = {}) {
  const search = new URLSearchParams({ atlasLayout: layout, ...params });
  return `${base}/#/atlas?${search.toString()}`;
}

async function clearRatio(page) {
  return page.evaluate(() => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const nodes = [
      ...document.querySelectorAll("[data-atlas-chrome]"),
      document.querySelector("[data-testid='atlas-spine-mobile']"),
      document.querySelector(".maplibregl-ctrl-bottom-right"),
      document.querySelector(".cesium-viewer-bottom.atlas-attribution"),
    ].filter(Boolean);
    const blocked = new Uint8Array(width * height);
    for (const node of nodes) {
      const rect = node.getBoundingClientRect();
      const left = Math.max(0, Math.floor(rect.left));
      const top = Math.max(0, Math.floor(rect.top));
      const right = Math.min(width, Math.ceil(rect.right));
      const bottom = Math.min(height, Math.ceil(rect.bottom));
      for (let y = top; y < bottom; y += 1) {
        blocked.fill(1, y * width + left, y * width + right);
      }
    }
    let covered = 0;
    for (const cell of blocked) covered += cell;
    return {
      clear: Number((1 - covered / (width * height)).toFixed(3)),
      width,
      height,
    };
  });
}

async function settle(page, region) {
  await page.getByLabel("Search places and routes").waitFor({ timeout: 20000 });
  await page.evaluate(() => document.fonts.ready);
  if (!region) {
    await page.waitForFunction(() => {
      const canvas = document.querySelector("canvas[data-atlas-engine='cesium']");
      return canvas?.dataset.cameraState === "settled";
    }, { timeout: 20000 }).catch(() => {});
    await page.getByRole("button", { name: /Crete, Greece/ }).waitFor({ timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(600);
    return;
  }
  await page.waitForSelector("[data-map-status='ready']", { timeout: 35000 }).catch(() => {});
  await page.waitForTimeout(1200);
}

const browser = await chromium.launch({
  channel: "chrome",
  args: ["--use-gl=angle", "--use-angle=swiftshader"],
});
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
});
page.setDefaultTimeout(20000);
const report = [];
page.on("pageerror", (error) => report.push(`pageerror ${error.message}`));

await mkdir(out, { recursive: true });

for (const layout of layouts) {
  await page.goto(atlasUrl(layout), { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await settle(page, false);
  const ratio = await clearRatio(page);
  report.push(`${layout} default clear ${ratio.clear}`);
  await page.screenshot({ path: `${out}/${layout}-default.png` });

  const regionParams = layout === "a" ? { region: crete, route } : { region: crete };
  await page.goto(atlasUrl(layout, regionParams), { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await settle(page, true);
  const regionRatio = await clearRatio(page);
  const sheet = await page.locator("[data-testid='atlas-prototype-sheet']").count();
  report.push(`${layout} region clear ${regionRatio.clear} sheet ${sheet}`);
  await page.screenshot({ path: `${out}/${layout}-region.png` });

  const filters = page.getByTestId("atlas-prototype-filters");
  if (!(await filters.isVisible().catch(() => false))) {
    await page.getByTestId("atlas-prototype-filter-toggle").click();
  }
  await filters.waitFor();
  await page.screenshot({ path: `${out}/${layout}-filters.png` });
  report.push(`${layout} filters open`);
}

await page.goto(atlasUrl("b", { region: crete, route }), { waitUntil: "domcontentloaded" });
await page.reload({ waitUntil: "domcontentloaded" });
await settle(page, true);
await page.screenshot({ path: `${out}/b-route.png` });
report.push("b route sheet saved");

const grabber = page.getByRole("button", { name: "Show more" });
if (await grabber.count()) {
  await grabber.click();
  await page.waitForTimeout(300);
  const detent = await page.getByTestId("atlas-prototype-sheet").getAttribute("data-detent");
  report.push(`b after grabber ${detent}`);
  await page.screenshot({ path: `${out}/b-medium.png` });
}

console.log(report.join("\n"));
await browser.close();
