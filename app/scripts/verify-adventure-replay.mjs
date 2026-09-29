/**
 * Adventure layer verification in a real browser.
 *
 * Exercises the showcase journey on the notebook Replay: chapter marks and
 * card, inspect-and-resume mid-playback, footage with a precise return, the
 * captured scene (live Sketchfab, reported separately), the film's beats and
 * its return, keyboard and reduced motion, at desktop and a narrow viewport.
 *
 * Needs a dev or preview server and an imported adventure in `.adventures/`
 * (see scripts/import-adventure.mjs). Evidence goes to OUT (ignored).
 *
 *   npm run dev -- --port 8789 --strictPort
 *   BASE=http://localhost:8789 npm run verify:adventure
 *
 * Sketchfab refuses Playwright's headless shell as an unsupported browser, so
 * the scene check needs full Chromium: set PW_CHROMIUM to a Chrome for Testing
 * executable. With the headless shell the scene reports "failed" and the
 * product's fallback path is what gets exercised.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";

import { adventureExpectations } from "./adventure-expectations.mjs";

const BASE = process.env.BASE ?? "http://localhost:8787";
const OUT = process.env.OUT ?? "../.godiesel/evidence/adventure-replay";
const SLUG = process.env.SLUG ?? "14130782031";
const FROM = encodeURIComponent(`/lab/design-seeds/d/story/${SLUG}`);
const REPLAY = `/#/replay/${SLUG}?landscape=notebook&from=${FROM}`;
fs.mkdirSync(OUT, { recursive: true });
const expected = adventureExpectations(SLUG);
const [first, second, third] = expected.here;
if (!third || !first.footageId || !expected.scenesHere.length || !expected.filmCta) {
  throw new Error("This verifier needs three chapters on the recording, footage on the first, a scene and a film.");
}
const km = (metres) => (metres / 1_000).toFixed(2);

const failures = [];
const notes = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures.push(name);
};
const note = (text) => { console.log(`  --   ${text}`); notes.push(text); };

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const progress = (page) => page.evaluate(() => Number(document.querySelector("[data-testid='replay-stage']")?.dataset.progress));
const playing = (page) => page.evaluate(() => document.querySelector("[aria-label='Pause route']") !== null);
const ready = (page) => page.waitForFunction(() => ["ready", "partial"].includes(document.querySelector("[data-testid='replay-stage']")?.dataset.state), null, { timeout: 30_000 });

for (const viewport of [{ width: 1440, height: 900, name: "desktop" }, { width: 390, height: 844, name: "mobile" }]) {
  console.log(`\n=== ${viewport.name} ${viewport.width}x${viewport.height} (${viewport.name === "mobile" ? "device emulation, not a physical device" : "desktop Chromium"})`);
  const context = await browser.newContext({ viewport, isMobile: viewport.name === "mobile", hasTouch: viewport.name === "mobile" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error).slice(0, 160)));
  const shot = (name) => page.screenshot({ path: `${OUT}/${viewport.name}-${name}.png` });

  await page.goto(BASE + REPLAY, { waitUntil: "load" });
  await ready(page);
  await page.waitForSelector("[data-testid='adventure-chapter-card']", { timeout: 15_000 });
  await page.waitForTimeout(2500);
  await shot("01-introduction");
  check("adventure layer present", await page.locator("[data-testid='replay-stage']").getAttribute("data-adventure") === expected.adventure.id);
  const marks = await page.locator("[data-testid='replay-adventure-mark']").evaluateAll((items) => items.map((item) => [item.dataset.markKind, Number(item.dataset.markDistanceM)]));
  check("chapter and scene marks on the climb", marks.filter(([kind]) => kind === "chapter").length === expected.here.length && marks.filter(([kind]) => kind === "scene").length === expected.scenesHere.length, JSON.stringify(marks));
  check("introduction card before the first chapter", first.anchor.atDistanceM === 0 || await page.locator("[data-testid='adventure-chapter-card']").getAttribute("data-chapter-id") === "introduction");

  // Keyboard: the next-chapter control moves to the first chapter on this recording.
  await page.getByRole("button", { name: new RegExp(`^Next chapter: ${expected.escape(first.title)}`) }).focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1500);
  check("keyboard seeks to the chapter's recorded distance", Math.abs((await progress(page)) - first.anchor.atDistanceM) < 1, String(await progress(page)));
  check("card follows the held distance", await page.locator("[data-testid='adventure-chapter-card']").getAttribute("data-chapter-id") === first.id);
  await shot("02-chapter");
  const covered = await page.evaluate(() => {
    const dot = document.querySelector(".relief-world-position")?.getBoundingClientRect();
    const card = document.querySelector("[data-testid='adventure-chapter-card']")?.getBoundingClientRect();
    const dock = document.querySelector("[data-testid='replay-controls']")?.getBoundingClientRect();
    if (!dot || !card || !dock) return "missing";
    const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    return overlaps(dot, card) || overlaps(dot, dock) || dot.top < 0 ? `dot ${Math.round(dot.left)},${Math.round(dot.top)}` : "";
  });
  check("the held position stays visible beside the card and dock", covered === "", covered);

  // Interrupt playback, inspect another chapter, resume exactly.
  await page.getByRole("button", { name: "Play route" }).click();
  await page.waitForTimeout(2500);
  const beforeInspect = await progress(page);
  check("playback advances", beforeInspect > first.anchor.atDistanceM + 20, String(beforeInspect));
  await page.locator("[data-testid='replay-adventure-mark'][data-mark-kind='chapter']").nth(2).click();
  await page.waitForTimeout(800);
  const inspected = await progress(page);
  check("inspecting a chapter pauses playback", !(await playing(page)));
  check("inspecting moves to that chapter", Math.abs(inspected - third.anchor.atDistanceM) < 1, String(inspected));
  const resume = page.getByRole("button", { name: /^Resume at / });
  check("resume offers the interrupted distance", await resume.isVisible(), await resume.textContent().catch(() => ""));
  await shot("03-inspect");
  const resumeLabel = await resume.textContent();
  await resume.click();
  await page.waitForTimeout(250);
  const resumed = await progress(page);
  check("resume returns to the interrupted distance and plays", Math.abs(resumed - beforeInspect) < 120 && (await playing(page)), `${beforeInspect.toFixed(1)} -> ${resumed.toFixed(1)} (${resumeLabel})`);
  await page.getByRole("button", { name: "Pause route" }).click();

  // Footage: pause beneath, precise return.
  await page.locator("[data-testid='replay-adventure-mark'][data-mark-kind='chapter']").nth(0).click();
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "Play route" }).click();
  await page.waitForTimeout(1200);
  const heldForFootage = await progress(page);
  await page.getByRole("button", { name: "Watch this moment" }).click();
  await page.waitForSelector("[data-testid='adventure-footage']");
  check("footage pauses the route beneath", !(await playing(page)));
  await page.waitForTimeout(2500);
  const clip = await page.evaluate(() => { const v = document.querySelector("[data-testid='adventure-footage'] video"); return v && { t: v.currentTime, muted: v.muted, paused: v.paused, w: v.videoWidth, h: v.videoHeight }; });
  check("footage plays muted by default", clip && clip.t > 0.5 && clip.muted && !clip.paused, JSON.stringify(clip));
  const focusInside = await page.evaluate(() => document.querySelector("[data-testid='adventure-footage']")?.contains(document.activeElement));
  check("focus moves into the footage", focusInside);
  await shot("04-footage");
  const heldBeneath = await progress(page);
  check("the route holds still beneath the footage", Math.abs(heldBeneath - (await progress(page))) < 0.01 && heldBeneath >= heldForFootage);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  const afterFootage = await progress(page);
  // Playback resumes at the held distance; 250 ms of 1x playback on this route is about 21 m.
  check("Escape returns to the held distance, still playing", afterFootage >= heldBeneath && afterFootage - heldBeneath < 45 && (await playing(page)), `${heldBeneath.toFixed(1)} -> ${afterFootage.toFixed(1)}`);
  check("focus returns to the page", await page.evaluate(() => !document.querySelector("[data-testid='adventure-footage']")));
  await page.getByRole("button", { name: "Pause route" }).click();

  // Captured scene (live third-party host).
  await page.getByRole("button", { name: /Step inside the scene/ }).click();
  await page.waitForSelector("[data-testid='adventure-scene']");
  const sceneState = await page.waitForFunction(() => {
    const state = document.querySelector("[data-testid='adventure-scene']")?.getAttribute("data-scene-state");
    return state === "ready" || state === "failed" ? state : false;
  }, null, { timeout: 150_000 }).then((handle) => handle.jsonValue()).catch(() => "loading");
  note(`captured scene reached "${sceneState}" from live Sketchfab (third-party availability, not a product guarantee)`);
  if (sceneState === "ready") await page.waitForTimeout(5000);
  await shot("05-scene");
  check("scene credit visible", await page.getByRole("link", { name: /on Sketchfab/ }).isVisible());
  const beforeSceneClose = await progress(page);
  await page.getByRole("button", { name: /^Back to the route at/ }).click();
  await page.waitForTimeout(300);
  check("scene returns to the same distance", Math.abs((await progress(page)) - beforeSceneClose) < 1);

  // Film: route pass moves the real camera; closing restores it.
  await page.locator("[data-testid='replay-adventure-mark'][data-mark-kind='chapter']").nth(1).click();
  await page.waitForTimeout(500);
  const heldForFilm = await progress(page);
  await page.getByRole("button", { name: "All chapters" }).click();
  await page.waitForTimeout(300);
  await shot("06-chapter-list");
  await page.locator("#adventure-chapter-list").getByRole("button", { name: expected.filmCta }).click();
  await page.waitForSelector("[data-testid='adventure-film']");
  await page.waitForTimeout(1500);
  await shot("07-film-open");
  const beats = [];
  for (let second = 0; second < 40; second += 1) {
    const kind = await page.locator("[data-testid='adventure-film']").getAttribute("data-beat-kind").catch(() => null);
    const index = await page.locator("[data-testid='adventure-film']").getAttribute("data-beat-index").catch(() => null);
    if (index !== null && !beats.some((beat) => beat.index === index)) {
      beats.push({ index, kind, at: second, progressM: await progress(page) });
      if (kind === "route") { await page.waitForTimeout(2000); await shot("08-film-route"); second += 2; }
      if (kind === "scene") { await page.waitForTimeout(1500); await shot("09-film-scene"); second += 1; }
    }
    if (await page.locator("[data-testid='adventure-film']").getAttribute("data-finished") === "true") break;
    await page.waitForTimeout(1000);
  }
  note(`film beats reached: ${beats.map((beat) => `${beat.index}:${beat.kind}@${beat.at}s`).join(" ")}`);
  check("film reached every beat", beats.length === expected.adventure.film.beats.length, `${beats.length} of ${expected.adventure.film.beats.length}`);
  const routeBeat = beats.find((beat) => beat.kind === "route");
  check("route beat moved the Replay camera along the recording", routeBeat && (await progress(page)) > heldForFilm + 1000, `${heldForFilm.toFixed(0)} -> ${(await progress(page)).toFixed(0)}`);
  await page.waitForTimeout(1500);
  await shot("10-film-end");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  check("film returns to the exact held distance", Math.abs((await progress(page)) - heldForFilm) < 1, `${heldForFilm} -> ${await progress(page)}`);
  check("camera range restored after the film", await page.locator("[data-testid='replay-stage']").getAttribute("data-camera-range") === "240");
  check("no page errors", errors.length === 0, errors.join(" | "));
  await context.close();
}

// Reduced motion: the film opens paused and the route beat never flies.
{
  console.log("\n=== reduced motion 1440x900");
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto(BASE + REPLAY, { waitUntil: "load" });
  await ready(page);
  await page.waitForSelector("[data-testid='adventure-chapter-card']");
  await page.getByRole("button", { name: expected.filmCta }).first().click();
  await page.waitForSelector("[data-testid='adventure-film']");
  await page.waitForTimeout(1500);
  check("film opens paused under reduced motion", await page.locator("[data-testid='adventure-film']").getAttribute("data-playing") === "false");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Next chapter:/ }).click();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Watch this moment" }).click();
  await page.waitForSelector("[data-testid='adventure-footage']");
  await page.waitForTimeout(1200);
  check("footage does not autoplay under reduced motion", await page.evaluate(() => document.querySelector("[data-testid='adventure-footage'] video")?.paused));
  await context.close();
}

// No adventure: an unrelated recording keeps the plain Replay.
{
  console.log("\n=== unrelated route");
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/#/replay/14130768855?landscape=notebook`, { waitUntil: "load" });
  await ready(page);
  await page.waitForTimeout(1500);
  check("no adventure layer on a route without one", (await page.locator("[data-testid='adventure-chapter-card']").count()) === 0 && (await page.locator("[data-testid='replay-adventure-mark']").count()) === 0);
  await context.close();
}

await browser.close();
fs.writeFileSync(`${OUT}/result.json`, JSON.stringify({ base: BASE, failures, notes, at: new Date().toISOString() }, null, 2));
console.log(failures.length ? `\n${failures.length} failed` : "\nall passed");
process.exit(failures.length ? 1 : 0);
