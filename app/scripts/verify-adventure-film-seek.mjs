/**
 * Seeking a paused film into its route beat moves the geography (review 2).
 *
 * Opens the film paused (reduced motion) and paused-after-play (normal), seeks
 * the film timeline into the route beat twice, and checks Replay's own
 * progress follows the beat while the film stays paused, then that closing
 * returns to the held distance. Runs on the notebook and on live Google 3D.
 *
 *   Google runs must use http://localhost:8787 (docs/agents/testing.md).
 *   BASE=http://localhost:8787 PW_CHROMIUM=<Chrome for Testing> node scripts/verify-adventure-film-seek.mjs
 */
import { chromium } from "@playwright/test";

import { adventureExpectations } from "./adventure-expectations.mjs";
import { imageryVariance, requireLiveGoogleBase, watchGoogleTiles } from "./live-google-evidence.mjs";

const BASE = process.env.BASE ?? "http://localhost:8787";
const SLUG = process.env.SLUG ?? "14130782031";
const renderers = (process.env.RENDERERS ?? "notebook,google").split(",");
if (renderers.includes("google")) requireLiveGoogleBase(BASE);
const expected = adventureExpectations(SLUG);
const beats = expected.adventure.film.beats;
const length = (beat) => (beat.kind === "footage" ? beat.outS - beat.inS : beat.durationS);
let routeStart = 0;
for (const beat of beats) { if (beat.kind === "route") break; routeStart += length(beat); }
const routeBeat = beats.find((beat) => beat.kind === "route");
if (!routeBeat) throw new Error("This film has no route beat.");

const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures.push(name);
};
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
for (const renderer of renderers) for (const reducedMotion of ["reduce", "no-preference"]) {
  console.log(`\n=== ${renderer}, reduced motion: ${reducedMotion}`);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion });
  const page = await context.newPage();
  const tiles = renderer === "google" ? watchGoogleTiles(page) : undefined;
  await page.goto(`${BASE}/#/replay/${SLUG}${renderer === "notebook" ? "?landscape=notebook" : ""}`, { waitUntil: "load" });
  await page.waitForFunction(() => document.querySelector("[data-testid='replay-stage']")?.dataset.state === "ready", null, { timeout: 60_000 });
  await page.waitForSelector("[data-testid='adventure-chapter-card']", { timeout: 20_000 });
  const stage = page.getByTestId("replay-stage");
  if (tiles) {
    await page.waitForTimeout(1500);
    check("Google map tiles arrived", tiles.ok > 0, `${tiles.ok} ok, ${tiles.failed} failed`);
    check("the rendered frame is imagery, not a blank canvas", (await imageryVariance(page)) > 12);
  }
  const total = (await page.evaluate(() => Number(document.querySelector("[data-testid='replay-stage']")?.dataset.progress))) ;
  const held = Number(await stage.getAttribute("data-progress"));
  await page.getByRole("button", { name: "All chapters" }).click();
  await page.locator("#adventure-chapter-list").getByRole("button", { name: expected.filmCta }).click();
  const film = page.getByTestId("adventure-film");
  await film.waitFor();
  if (reducedMotion === "no-preference") {
    await page.waitForTimeout(800);
    await film.getByRole("button", { name: "Pause the film" }).click();
  }
  check("the film is paused before seeking", (await film.getAttribute("data-playing")) === "false");
  const totalDistance = Number((await page.evaluate(() => document.querySelector("[data-testid='replay-stage']")?.getAttribute("data-route-slug"))) && (await page.evaluate(async () => {
    const response = await fetch(`${location.origin}/data/routes/${document.querySelector("[data-testid='replay-stage']").dataset.routeSlug}.json`);
    const route = await response.json();
    return route.route.at(-1).d;
  })));
  const readings = [];
  for (const fraction of [0.25, 0.75]) {
    const seconds = routeStart + fraction * routeBeat.durationS;
    await film.getByLabel("Film position").fill(String(seconds));
    await page.waitForTimeout(700);
    const progress = Number(await stage.getAttribute("data-progress"));
    readings.push(progress);
    check(`seek to ${seconds.toFixed(1)} s moves the route to ${(fraction * 100).toFixed(0)}% of the recording`, Math.abs(progress - fraction * totalDistance) < totalDistance * 0.01, `${progress.toFixed(0)} of ${totalDistance.toFixed(0)} m`);
    check("and the film stays paused", (await film.getAttribute("data-playing")) === "false" && (await film.getAttribute("data-beat-kind")) === "route");
  }
  await page.waitForTimeout(800);
  check("the route holds still while paused", Math.abs(Number(await stage.getAttribute("data-progress")) - readings.at(-1)) < 0.5);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
  check("Escape closes the film and stays in Replay", page.url().includes(`#/replay/${SLUG}`) && (await page.getByTestId("adventure-film").count()) === 0, new URL(page.url()).hash.slice(0, 40));
  check("closing returns to the held distance", Math.abs(Number(await stage.getAttribute("data-progress")) - held) < 1, `${held} -> ${await stage.getAttribute("data-progress")}`);
  // The same for footage: Escape closes it without leaving Replay.
  await page.getByRole("button", { name: /^Next chapter:/ }).click();
  await page.waitForTimeout(800);
  const watch = page.getByRole("button", { name: /Watch this moment|Watch the flyover/ });
  if (await watch.count()) {
    await watch.click();
    await page.getByTestId("adventure-footage").waitFor();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
    check("Escape closes footage and stays in Replay", page.url().includes(`#/replay/${SLUG}`) && (await page.getByTestId("adventure-footage").count()) === 0);
  }
  void total;
  await context.close();
}
await browser.close();
console.log(failures.length ? `\n${failures.length} failed` : "\nall passed");
process.exit(failures.length ? 1 : 0);
