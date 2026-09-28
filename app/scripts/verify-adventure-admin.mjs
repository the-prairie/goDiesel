/**
 * The owner's adventure workspace in a real browser: nudge a chapter along its
 * recording, save through the local writer, confirm the store and Replay
 * reflect it, check media digests, record a publication plan (nothing is
 * published), then move the chapter back and save again.
 *
 *   npm run dev -- --port 8789 --strictPort
 *   BASE=http://localhost:8789 node scripts/verify-adventure-admin.mjs
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { adventureExpectations } from "./adventure-expectations.mjs";

const BASE = process.env.BASE ?? "http://localhost:8787";
const OUT = process.env.OUT ?? "../.godiesel/evidence/adventure-admin";
const SLUG = process.env.SLUG ?? "14130782031";
const STORE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".adventures");
fs.mkdirSync(OUT, { recursive: true });
const expected = adventureExpectations(SLUG);
const chapter = expected.here[0];
const file = path.join(STORE, expected.adventure.id, "adventure.json");
// The store is the owner's; leave it byte-for-byte as it was found.
const original = fs.readFileSync(file);
const planFile = path.join(STORE, expected.adventure.id, "publication-plan.json");
const hadPlan = fs.existsSync(planFile);
const originalPlan = hadPlan ? fs.readFileSync(planFile) : undefined;
const restore = () => {
  fs.writeFileSync(file, original);
  if (hadPlan) fs.writeFileSync(planFile, originalPlan);
  else fs.rmSync(planFile, { force: true });
};
process.on("exit", restore);
const stored = () => JSON.parse(fs.readFileSync(file, "utf8")).chapters.find((item) => item.id === chapter.id).anchor.atDistanceM;

const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures.push(name);
};

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error).slice(0, 160)));
await page.goto(`${BASE}/#/admin`, { waitUntil: "load" });
await page.waitForSelector("[data-testid='adventure-workspace'] [data-chapter-id]", { timeout: 20_000 });
await page.waitForTimeout(1500);
const workspace = page.getByTestId("adventure-workspace");
check("the writer is connected on the dev server", await workspace.getByText("Local adventure writer connected").isVisible());
check("placement confirmed before editing", (await workspace.getByTestId("adventure-readiness").locator("[data-check='placement']").getAttribute("data-state")) === "pass");

const row = workspace.locator(`[data-chapter-id='${chapter.id}']`);
const before = stored();
await row.getByRole("button", { name: /forward 25 m/ }).click();
await page.waitForTimeout(300);
check("a nudge shows the owner's move", /moved \d+ m by the owner/.test(await row.locator("[data-anchor-state]").innerText()));
await workspace.getByRole("button", { name: "Save adventure" }).click();
await page.waitForTimeout(800);
const after = stored();
check("saving writes the moved placement to the local store", Math.abs(after - (before + 25)) < 0.2, `${before} -> ${after}`);
await page.screenshot({ path: `${OUT}/desktop-01-moved.png`, fullPage: true });

await workspace.getByRole("button", { name: "Check media digests" }).click();
await page.waitForFunction(() => document.querySelector("[data-check='media']")?.getAttribute("data-state") !== "unchecked", null, { timeout: 30_000 });
check("media digests match the import", (await workspace.locator("[data-check='media']").getAttribute("data-state")) === "pass", await workspace.locator("[data-check='media']").innerText());
check("the audience stays the owner's decision", (await workspace.locator("[data-check='audience']").getAttribute("data-state")) === "decision");
await workspace.getByRole("button", { name: "Record publication plan" }).click();
await page.waitForTimeout(600);
const plan = fs.existsSync(planFile) ? JSON.parse(fs.readFileSync(planFile, "utf8")) : null;
check("a publication plan is recorded, with no audience chosen", plan?.audience === null && plan?.checks?.length === 6);
await page.screenshot({ path: `${OUT}/desktop-02-readiness.png`, fullPage: true });

await page.goto(`${BASE}/#/replay/${SLUG}?landscape=notebook`, { waitUntil: "load" });
await page.waitForSelector("[data-testid='adventure-chapter-card']", { timeout: 30_000 });
const mark = await page.locator("[data-testid='replay-adventure-mark'][data-mark-kind='chapter']").first().getAttribute("data-mark-distance-m");
check("Replay places the chapter where the owner moved it", Math.abs(Number(mark) - after) < 0.2, mark ?? "");

await page.goto(`${BASE}/#/admin`, { waitUntil: "load" });
await page.waitForSelector(`[data-testid='adventure-workspace'] [data-chapter-id='${chapter.id}']`, { timeout: 20_000 });
await page.waitForTimeout(1000);
await page.getByTestId("adventure-workspace").locator(`[data-chapter-id='${chapter.id}']`).getByRole("button", { name: /back 25 m/ }).click();
await page.getByTestId("adventure-workspace").getByRole("button", { name: "Save adventure" }).click();
await page.waitForTimeout(800);
check("moving it back restores the imported distance", Math.abs(stored() - before) < 0.2, String(stored()));
check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
restore();
console.log(failures.length ? `\n${failures.length} failed` : "\nall passed");
process.exit(failures.length ? 1 : 0);
