/**
 * Direction D verification: the carried notebook.
 *
 * Exercises the whole experience against the running application, in the order
 * a reader meets it:
 *
 *   1. the thread - photographs pinned at their recorded distances, the map
 *      handle and the climb ribbon reporting one position, keyboard control
 *   2. the journey - region, day, hold the thread, descend, Replay entering at
 *      the held distance, and the return through the visible links
 *
 * Needs a running dev or preview server and network access for the vector
 * basemap (openfreemap) and the elevation DEM (Mapzen Terrain Tiles on AWS).
 *
 *   npm run dev
 *   npm run verify:direction-d
 *
 * Override the target with BASE, e.g. BASE=http://localhost:8788.
 */
import { chromium } from "@playwright/test";

const BASE = process.env.BASE ?? "http://localhost:8787";
const CRETE = encodeURIComponent("Crete, Greece");
const BANFF = encodeURIComponent("Banff/Kananaskis");
const KYOTO = encodeURIComponent("Kyoto, Japan");

/* Kyoto is the only day in the collection with photographs; Banff has none,
   which is why it is the primary case for the journey. */
const KYOTO_SLUG = "17654151284";
const BANFF_SLUG = "15573295095";

const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures.push(name);
};

const browser = await chromium.launch({ headless: process.env.HEADLESS === "1" || process.platform !== "darwin" });

/* -------------------------------- 1. the thread ------------------------------ */
{
  console.log("\n1. the thread, on a day that has photographs");
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error).slice(0, 160)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text().slice(0, 160));
  });

  await page.goto(`${BASE}/#/lab/design-seeds/d/story/${KYOTO_SLUG}?region=${KYOTO}`, {
    waitUntil: "load",
  });
  await page.waitForTimeout(13000);

  check("photographs pinned on the map", (await page.locator(".seed-thread-photo").count()) === 2);
  check("and on the climb", (await page.locator(".seed-ribbon-photo").count()) === 2);

  const ribbon = page.locator(".seed-ribbon").first();
  const box = await ribbon.boundingBox();
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
  await page.mouse.down();
  for (let step = 2; step <= 7; step += 1) {
    await page.mouse.move(box.x + box.width * (step / 10), box.y + box.height / 2);
    await page.waitForTimeout(60);
  }
  await page.mouse.up();
  await page.waitForTimeout(600);

  const climbValue = await ribbon.getAttribute("aria-valuetext");
  check("dragging the climb reports a position", /kilometres/.test(climbValue ?? ""), climbValue ?? "");

  const handle = page.locator(".seed-thread-grab");
  check("a handle appears on the recorded line", (await handle.count()) === 1);
  const handleValue = await handle.getAttribute("aria-valuetext");
  check("map handle and climb are one value", handleValue === climbValue, `${handleValue} vs ${climbValue}`);

  await page.locator(".seed-ribbon-photo").first().click();
  await page.waitForTimeout(900);
  const caption = await page.locator("figcaption").innerText().catch(() => "");
  check(
    "holding the thread at a photograph raises it",
    (await page.locator("figure img").count()) === 1,
    `caption "${caption.replace(/\s+/g, " ")}"`,
  );

  await handle.focus();
  const before = Number(await handle.getAttribute("aria-valuenow"));
  for (let press = 0; press < 6; press += 1) await handle.press("ArrowRight");
  await page.waitForTimeout(300);
  const after = Number(await handle.getAttribute("aria-valuenow"));
  check("arrow keys move the handle", after > before, `${before} -> ${after}`);

  console.log("  page errors:", errors.length, errors.slice(0, 2));
  check("no page errors", errors.length === 0);
  await context.close();
}

/* ------------------------------- 2. the journey ------------------------------ */
{
  console.log("\n2. the journey, on a day with no photographs");
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error).slice(0, 160)));

  await page.goto(`${BASE}/#/lab/design-seeds/d/atlas?region=${BANFF}&route=${BANFF_SLUG}`, {
    waitUntil: "load",
  });
  await page.waitForTimeout(12000);
  check("the region shows the whole collection", (await page.locator("ol li").count()) > 1);

  await page.getByRole("link", { name: /Enter this day/i }).click();
  await page.waitForTimeout(12000);
  check("the day opened", page.url().includes(`/d/story/${BANFF_SLUG}`));

  const ribbon = page.locator(".seed-ribbon").first();
  const box = await ribbon.boundingBox();
  await page.mouse.move(box.x + box.width * 0.52, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height / 2);
  await page.mouse.up();
  await page.waitForTimeout(800);
  const held = await ribbon.getAttribute("aria-valuetext");
  check("the thread is held", /kilometres/.test(held ?? ""), held ?? "");

  const entry = page.locator('button:has-text("Enter at")');
  const label = await entry.innerText().catch(() => "");
  check("the entry action names the chosen place", /Enter at/.test(label), label.replace(/\s+/g, " "));

  const exactHeld = Number(await ribbon.getAttribute("aria-valuenow"));
  const world = await page.locator("[data-relief-world]").getAttribute("data-relief-world");
  await page.evaluate(() => {
    const map = window.__reliefMap;
    window.__dFrames = [];
    window.__dMove = () => window.__dFrames.push({ zoom: map.getZoom(), pitch: map.getPitch() });
    map.on("move", window.__dMove);
  });
  await entry.click();
  await page.getByTestId("replay-stage").waitFor();
  const descent = await page.evaluate(() => { window.__reliefMap.off("move", window.__dMove); return window.__dFrames; });
  check("the camera descends through intermediate positions", descent.length > 3 && Math.abs(descent.at(-1).zoom - descent[0].zoom) > 0.1);

  check("Replay is reached", page.url().includes(`#/replay/${BANFF_SLUG}`));
  const entered = Number(new URL(page.url().replace("#", "?hash=")).searchParams.get("at"));
  const atFromHash = Number((page.url().match(/[?&]at=(\d+)/) ?? [])[1]);
  check("carrying the entry distance", Number.isFinite(atFromHash) && atFromHash > 0, `at=${atFromHash || entered}`);

  check("initial Replay position equals the held distance", Number(await page.getByTestId("replay-stage").getAttribute("data-progress")) === exactHeld);
  check("Replay keeps the entered terrain world", world === await page.locator("[data-relief-world]").getAttribute("data-relief-world"));
  await page.getByRole("button", { name: /^Play route$/ }).click();
  await page.waitForTimeout(4500);
  const progress = await page
    .locator("text=/\\d+\\.\\d+ \\/ \\d+\\.\\d+ km/")
    .first()
    .innerText()
    .catch(() => "");
  const km = Number((progress.match(/([\d.]+)/) ?? [])[1]);
  check("playback begins at the held distance, not at the start", km > 1, progress);
  await page.getByRole("button", { name: /^Pause route$/ }).click().catch(() => {});

  await page
    .getByRole("link", { name: /Route story|Back to Atlas/i })
    .first()
    .click();
  await page.waitForTimeout(12000);
  check("the visible link returns to the day", page.url().includes(`/d/story/${BANFF_SLUG}`));
  const restored = await page.locator(".seed-ribbon").first().getAttribute("aria-valuetext");
  check("with the thread where it was left", restored === held, `${held} -> ${restored}`);

  await page.locator("header a").first().click();
  await page.waitForTimeout(9000);
  check("and back to the region", page.url().includes("/d/atlas"), new URL(page.url()).hash.slice(0, 70));

  console.log("  page errors:", errors.length, errors.slice(0, 2));
  check("no page errors", errors.length === 0);
  await context.close();
}

await browser.close();
console.log(
  failures.length ? `\nFAILED: ${failures.join(" | ")}` : "\nDirection D verified end to end.",
);
process.exit(failures.length ? 1 : 0);
