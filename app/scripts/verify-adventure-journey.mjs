/**
 * The showcase journey end to end, through visible controls only:
 *
 *   region in the notebook Atlas -> the day -> the adventure's chapter held on
 *   the thread -> descent into Replay at that chapter -> footage and back ->
 *   the visible return to the day, thread where it was -> back to the region.
 *   Also: a chapter on the adventure's other recording opens that day.
 *
 *   npm run dev -- --port 8789 --strictPort
 *   BASE=http://localhost:8789 node scripts/verify-adventure-journey.mjs
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";

import { adventureExpectations } from "./adventure-expectations.mjs";

const BASE = process.env.BASE ?? "http://localhost:8787";
const OUT = process.env.OUT ?? "../.godiesel/evidence/adventure-journey";
const SLUG = process.env.SLUG ?? "14130782031";
const REGION = encodeURIComponent(process.env.REGION ?? "Crete, Greece");
fs.mkdirSync(OUT, { recursive: true });
const expected = adventureExpectations(SLUG);
const target = expected.withFootage.at(-1) ?? expected.here[0];
const other = expected.elsewhere[0];
const OTHER = other?.anchor.slug;
const km1 = (target.anchor.atDistanceM / 1_000).toFixed(1);
const km2 = (target.anchor.atDistanceM / 1_000).toFixed(2);

const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures.push(name);
};

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
for (const viewport of [{ width: 1440, height: 900, name: "desktop" }, { width: 390, height: 844, name: "mobile" }]) {
  console.log(`\n=== ${viewport.name} ${viewport.width}x${viewport.height}${viewport.name === "mobile" ? " (device emulation)" : ""}`);
  const context = await browser.newContext({ viewport, isMobile: viewport.name === "mobile", hasTouch: viewport.name === "mobile" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error).slice(0, 160)));
  const shot = (name) => page.screenshot({ path: `${OUT}/${viewport.name}-${name}.png` });
  const started = Date.now();

  await page.goto(`${BASE}/#/lab/design-seeds/d/atlas?region=${REGION}&route=${SLUG}`, { waitUntil: "load" });
  await page.waitForTimeout(9000);
  await shot("01-atlas");
  // Two panes select then enter; on a phone each journal row is the link to its day.
  if (viewport.name === "mobile") await page.locator(`a[href*="/d/story/${SLUG}"]`).first().click();
  else await page.getByRole("link", { name: /Enter this day/i }).first().click();
  await page.waitForFunction(() => document.querySelector("[data-testid='seed-adventure']"), null, { timeout: 20_000 });
  await page.waitForFunction(() => !document.querySelector("button[disabled]")?.textContent?.includes("loading"), null, { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(5000);
  check("the day opened", page.url().includes(`/d/story/${SLUG}`));
  const section = page.getByTestId("seed-adventure");
  await section.scrollIntoViewIfNeeded();
  await shot("02-day-adventure");
  check("the day names its adventure", (await section.locator("h2").innerText()) === expected.adventure.title);

  const row = section.getByRole("button", { name: new RegExp(`chapter ${target.ordinal}, ${expected.escape(target.title)}`) });
  await row.click();
  await page.waitForTimeout(900);
  const ribbon = page.locator(".seed-ribbon").first();
  const held = Number(await ribbon.getAttribute("aria-valuenow"));
  check("choosing a chapter holds the thread at its recorded distance", Math.abs(held - target.anchor.atDistanceM) < 1, String(held));
  check("the chapter row shows it is held", (await row.getAttribute("aria-pressed")) === "true");
  const entry = page.locator('button:has-text("Enter at")');
  check("entry names the chapter's place", (await entry.innerText()).includes(`Enter at ${km1} km`), await entry.innerText());
  await entry.scrollIntoViewIfNeeded();
  await shot("03-held-at-chapter");

  await entry.click();
  await page.getByTestId("replay-stage").waitFor();
  await page.waitForSelector("[data-testid='adventure-chapter-card']", { timeout: 20_000 });
  await page.waitForTimeout(2500);
  check("Replay opens at the held chapter", Math.abs(Number(await page.getByTestId("replay-stage").getAttribute("data-progress")) - target.anchor.atDistanceM) < 1);
  check("with that chapter's card", (await page.getByTestId("adventure-chapter-card").getAttribute("data-chapter-id")) === target.id);
  await shot("04-replay-at-chapter");

  await page.getByRole("button", { name: "Watch this moment" }).click();
  await page.waitForSelector("[data-testid='adventure-footage']");
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: new RegExp(`^Back to the route at ${expected.escape(km2)} km`) }).click();
  await page.waitForTimeout(400);
  check("footage returns to the chapter", Math.abs(Number(await page.getByTestId("replay-stage").getAttribute("data-progress")) - target.anchor.atDistanceM) < 1);

  await page.getByRole("link", { name: /Route story|Back to Atlas/i }).first().click();
  await page.waitForTimeout(9000);
  check("the visible link returns to the day", page.url().includes(`/d/story/${SLUG}`));
  const restored = Number(await page.locator(".seed-ribbon").first().getAttribute("aria-valuenow"));
  check("with the thread still at the chapter", Math.abs(restored - target.anchor.atDistanceM) < 1, String(restored));
  await shot("05-returned");

  if (other) {
    // Review finding: the held distance here (at=<target>) must not ride along
    // to another recording's day; each link targets its own chapter.
    await page.getByTestId("seed-adventure").getByRole("link", { name: new RegExp(expected.escape(other.title)) }).click();
    await page.waitForTimeout(6000);
    check("a chapter on the other recording opens that day", page.url().includes(`/d/story/${OTHER}`));
    const heldThere = Number(await page.locator(".seed-ribbon").first().getAttribute("aria-valuenow"));
    check("held at that chapter's own distance", Math.abs(heldThere - other.anchor.atDistanceM) < 1, `${heldThere} m (chapter ${other.anchor.atDistanceM} m)`);
    check("and its row shows it is held", (await page.getByTestId("seed-adventure").getByRole("button", { name: new RegExp(`chapter ${other.ordinal}, `) }).getAttribute("aria-pressed")) === "true");
    // From there, chapters back on the first recording, at distinct distances.
    const back = adventureExpectations(OTHER).elsewhere.filter((chapter) => chapter.anchor.slug === SLUG).slice(0, 2);
    for (const chapter of back) {
      await page.getByTestId("seed-adventure").getByRole("link", { name: new RegExp(expected.escape(chapter.title)) }).click();
      await page.waitForTimeout(5000);
      const held = Number(await page.locator(".seed-ribbon").first().getAttribute("aria-valuenow"));
      check(`link to chapter ${chapter.ordinal} holds ${chapter.anchor.atDistanceM} m`, page.url().includes(`/d/story/${SLUG}`) && Math.abs(held - chapter.anchor.atDistanceM) < 1, `${held} m`);
      await page.goBack();
      await page.waitForTimeout(4000);
    }
    await page.goBack();
    await page.waitForTimeout(6000);
  }

  await page.locator("header a").first().click();
  await page.waitForTimeout(8000);
  check("and back to the region", page.url().includes("/d/atlas") && page.url().includes("Crete"), new URL(page.url()).hash.slice(0, 80));
  check("no page errors", errors.length === 0, errors.join(" | "));
  console.log(`  --   journey wall time ${(Date.now() - started) / 1000}s (includes fixed settle waits)`);
  await context.close();
}
await browser.close();
console.log(failures.length ? `\n${failures.length} failed: ${failures.join(" | ")}` : "\nall passed");
process.exit(failures.length ? 1 : 0);
