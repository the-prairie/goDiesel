/**
 * Cross-recording chapter entry on both Replay renderers (review finding 1).
 *
 * From one recording's Replay, the chapter list links to a chapter on the
 * adventure's other recording with ?at=<distance>. The destination must open
 * at that distance, not at the start, on the notebook renderer and on Google
 * photorealistic 3D. Expectations come from the local store (no copy here).
 *
 *   BASE=http://127.0.0.1:8789 PW_CHROMIUM=<Chrome for Testing> node scripts/verify-adventure-cross-leg.mjs
 *   RENDERERS=notebook   (skip the live Google run)
 */
import { chromium } from "@playwright/test";

import { adventureExpectations } from "./adventure-expectations.mjs";

const BASE = process.env.BASE ?? "http://127.0.0.1:8789";
const renderers = (process.env.RENDERERS ?? "notebook,google").split(",");
const FROM = process.env.FROM ?? "14130772463";
const expected = adventureExpectations(FROM);
const target = expected.elsewhere.find((chapter) => chapter.anchor.atDistanceM > 0);
if (!target) throw new Error("This adventure has no non-zero chapter on another recording.");

const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures.push(name);
};
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
for (const renderer of renderers) {
  console.log(`\n=== ${renderer}: ${FROM} -> chapter ${target.ordinal} on ${target.anchor.slug} at ${target.anchor.atDistanceM} m`);
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const query = renderer === "notebook" ? "?landscape=notebook" : "";
  await page.goto(`${BASE}/#/replay/${FROM}${query}`, { waitUntil: "load" });
  await page.waitForFunction(() => document.querySelector("[data-testid='replay-stage']")?.dataset.state === "ready", null, { timeout: 60_000 });
  await page.waitForSelector("[data-testid='adventure-chapter-card']", { timeout: 20_000 });
  await page.getByRole("button", { name: "All chapters" }).click();
  const link = page.locator("#adventure-chapter-list a").filter({ hasText: target.title }).first();
  const href = await link.getAttribute("href");
  check("the chapter link carries its distance", new RegExp(`[?&]at=${Math.round(target.anchor.atDistanceM)}(&|$)`).test(href ?? ""), href ?? "");
  await link.click();
  await page.waitForFunction((slug) => document.querySelector("[data-testid='replay-stage']")?.dataset.routeSlug === slug, target.anchor.slug, { timeout: 30_000 });
  await page.waitForFunction(() => document.querySelector("[data-testid='replay-stage']")?.dataset.state === "ready", null, { timeout: 60_000 });
  await page.waitForTimeout(1500);
  const stage = page.getByTestId("replay-stage");
  const engine = await stage.getAttribute("data-engine");
  const progress = Number(await stage.getAttribute("data-progress"));
  check("the other recording opened", (await stage.getAttribute("data-route-slug")) === target.anchor.slug);
  check(`at the chapter's distance on ${engine}`, Math.abs(progress - target.anchor.atDistanceM) < 1, `${progress} m`);
  check("with that chapter's card", (await page.getByTestId("adventure-chapter-card").getAttribute("data-chapter-id")) === target.id);
  check("the presentation carried over", renderer === "google" ? engine === "google-3d-maps" : engine === "maplibre-notebook", engine ?? "");
  await page.close();
}
await browser.close();
console.log(failures.length ? `\n${failures.length} failed` : "\nall passed");
process.exit(failures.length ? 1 : 0);
