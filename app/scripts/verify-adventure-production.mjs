/**
 * The adventure through production surfaces only (no lab routes), on the
 * default Replay renderer:
 *
 *   A. Atlas region -> "Open route" -> Replay with the adventure layer ->
 *      a chapter, its footage -> "Back to Atlas" with region and route kept.
 *   B. Routes library -> route story -> its Adventure section -> "Replay from
 *      here" at a chapter (and on the other recording) -> back to the story.
 *
 * Expectations come from the local store. Google runs need localhost:8787.
 *   BASE=http://localhost:8787 node scripts/verify-adventure-production.mjs
 */
import { chromium } from "@playwright/test";

import { adventureExpectations } from "./adventure-expectations.mjs";
import { imageryVariance, requireLiveGoogleBase, watchGoogleTiles } from "./live-google-evidence.mjs";

const BASE = process.env.BASE ?? "http://localhost:8787";
requireLiveGoogleBase(BASE);
const SLUG = process.env.SLUG ?? "14130782031";
const REGION = process.env.REGION ?? "Crete, Greece";
const expected = adventureExpectations(SLUG);
const target = expected.withFootage.at(-1) ?? expected.here[0];
const other = expected.elsewhere.find((chapter) => chapter.anchor.atDistanceM >= 0);

const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures.push(name);
};
const ready = (page) => page.waitForFunction(() => document.querySelector("[data-testid='replay-stage']")?.dataset.state === "ready", null, { timeout: 60_000 });
const progress = async (page) => Number(await page.getByTestId("replay-stage").getAttribute("data-progress"));

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
for (const viewport of [{ width: 1440, height: 900, name: "desktop" }, { width: 390, height: 844, name: "mobile" }]) {
  console.log(`\n=== ${viewport.name} ${viewport.width}x${viewport.height}${viewport.name === "mobile" ? " (device emulation)" : ""}`);
  const context = await browser.newContext({ viewport, isMobile: viewport.name === "mobile", hasTouch: viewport.name === "mobile" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error).slice(0, 160)));
  const tiles = watchGoogleTiles(page);

  // A. Atlas -> Replay -> Atlas
  await page.goto(`${BASE}/#/atlas?region=${encodeURIComponent(REGION)}&route=${SLUG}`, { waitUntil: "load" });
  const open = page.locator(`a[href*="/replay/${SLUG}"]`).filter({ hasText: "Open route" }).first();
  await open.waitFor({ timeout: 60_000 });
  await open.click();
  await ready(page);
  await page.waitForSelector("[data-testid='adventure-chapter-card']", { timeout: 20_000 });
  check("Atlas opens Replay with the adventure layer", (await page.getByTestId("replay-stage").getAttribute("data-adventure")) === expected.adventure.id, await page.getByTestId("replay-stage").getAttribute("data-engine"));
  const imagery = await imageryVariance(page);
  check("on live imagery", tiles.ok > 0 && Boolean(imagery && imagery.spread > 12), `${tiles.ok} NodeData, spread ${imagery?.spread.toFixed(1)}`);
  await page.getByRole("button", { name: "All chapters" }).click();
  await page.locator("#adventure-chapter-list button").filter({ hasText: target.title }).first().click();
  await page.waitForTimeout(1200);
  check("a chapter is inspected at its distance", Math.abs((await progress(page)) - target.anchor.atDistanceM) < 1, String(await progress(page)));
  await page.getByRole("button", { name: "Watch this moment" }).click();
  await page.getByTestId("adventure-footage").waitFor();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
  check("footage returns to the chapter, still in Replay", page.url().includes(`#/replay/${SLUG}`) && Math.abs((await progress(page)) - target.anchor.atDistanceM) < 1);
  await page.mouse.move(viewport.width / 2, viewport.height / 3);
  await page.getByRole("button", { name: "Back to Atlas" }).click();
  await page.waitForTimeout(2500);
  const atlas = decodeURIComponent(new URL(page.url()).hash);
  check("Back to Atlas keeps region and route", atlas.startsWith("#/atlas") && atlas.includes(REGION.replaceAll(" ", "+")) === false ? atlas.includes(REGION) || atlas.includes(REGION.replaceAll(" ", "+")) : true, atlas.slice(0, 70));
  check("with region and route in the address", atlas.includes(`route=${SLUG}`) && (atlas.includes(REGION) || atlas.includes(REGION.replaceAll(" ", "+"))));

  // B. Routes library -> story -> Replay at a chapter -> story
  await page.goto(`${BASE}/#/routes/${SLUG}`, { waitUntil: "load" });
  const section = page.getByTestId("route-adventure");
  await section.waitFor({ timeout: 20_000 });
  await section.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `../.godiesel/evidence/adventure-production-${viewport.name}-story.png` });
  check("the story shows its adventure", (await section.locator("h2").innerText()) === expected.adventure.title);
  await section.getByRole("link", { name: new RegExp(`chapter ${target.ordinal}, `) }).click();
  await ready(page);
  await page.waitForSelector("[data-testid='adventure-chapter-card']", { timeout: 20_000 });
  check("Replay from here enters at the chapter", Math.abs((await progress(page)) - target.anchor.atDistanceM) < 1 && (await page.getByTestId("adventure-chapter-card").getAttribute("data-chapter-id")) === target.id, String(await progress(page)));
  await page.mouse.move(viewport.width / 2, viewport.height / 3);
  await page.getByRole("button", { name: "Route story" }).click();
  await page.waitForTimeout(2000);
  check("and returns to the story", new URL(page.url()).hash.startsWith(`#/routes/${SLUG}`));
  if (other) {
    await page.getByTestId("route-adventure").getByRole("link", { name: new RegExp(`chapter ${other.ordinal}, .*on `) }).click();
    await ready(page);
    check("a chapter on the other recording opens that recording at its distance", (await page.getByTestId("replay-stage").getAttribute("data-route-slug")) === other.anchor.slug && Math.abs((await progress(page)) - other.anchor.atDistanceM) < 1, `${await page.getByTestId("replay-stage").getAttribute("data-route-slug")} @ ${await progress(page)}`);
  }
  check("no page errors", errors.length === 0, errors.join(" | "));
  await context.close();
}
await browser.close();
console.log(failures.length ? `\n${failures.length} failed` : "\nall passed");
process.exit(failures.length ? 1 : 0);
