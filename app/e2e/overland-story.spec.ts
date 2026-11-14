import { expect, test, type Page } from "@playwright/test";

import { installGoogleReplay } from "./helpers/google-replay";

// Her story in Overland: the signpost as the route's trailer (her title,
// then her note, and her photos beside it), and her moments met along the
// route in the 3D world. Every word is hers or a plain fact.

const GOLD = { slug: "17636880071", number: "064", note: "too busy weeping to notice my camera was shooting upside down???????" };
const PEACH = { slug: "17654151284", number: "065" };
// Her only editorial annotations are on a route she has not completed, which
// Overland does not show, so an editorial moment is a fixture on a completed route.
const EDITORIAL = { id: "fixture-editorial", at_distance_m: 1500, kind: "note", evidence: "hypothesis", title: "Fixture title", body: "Fixture body." };

async function withEditorialMoment(page: Page) {
  await page.route(`**/data/routes/${GOLD.slug}.json`, async (route) => {
    const response = await route.fetch();
    const detail = await response.json();
    detail.annotations = [EDITORIAL, ...(detail.annotations ?? [])];
    await route.fulfill({ response, json: detail });
  });
}

const sign = (page: Page, number: string) => page.getByTestId("overland-town-signs").getByRole("button", { name: new RegExp(`^No\\. ${number}:`) });
const box = (page: Page) => page.getByTestId("overland-town-box");
const slider = (page: Page) => page.getByRole("slider", { name: "Route progress" });

async function openKyoto(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#/lab/overland/town/kyoto-japan?quality=low");
  await expect(page.getByTestId("overland-town")).toHaveAttribute("data-town-phase", "ready", { timeout: 30_000 });
}

test("a signpost with her note pages to it, whole; one without is a single clean page", async ({ page }) => {
  await openKyoto(page);
  await sign(page, GOLD.number).focus();
  await expect(box(page)).toHaveAttribute("data-pages", "2");
  await expect(sign(page, GOLD.number)).toHaveAccessibleDescription(GOLD.note);
  await page.getByTestId("overland-town-box-page").focus();
  await page.keyboard.press("Enter");
  await expect(box(page)).toHaveAttribute("data-page", "2");
  await page.keyboard.press("Space");
  await expect(box(page)).toHaveAttribute("data-page", "1");

  await sign(page, PEACH.number).focus();
  await expect(box(page)).toHaveAttribute("data-pages", "1");
  await expect(page.getByTestId("overland-town-box-page")).toHaveCount(0);
});

test("her photos hang beside the signpost and open, with her caption, in a viewer that keeps the keyboard", async ({ page }) => {
  await openKyoto(page);
  await sign(page, PEACH.number).focus();
  const polaroids = page.getByTestId("overland-polaroid");
  await expect(polaroids).toHaveCount(2);
  await expect(polaroids.first()).toHaveAccessibleName("Photo: Stone stairway");
  await expect(sign(page, GOLD.number)).toBeVisible();

  await polaroids.first().focus();
  await page.keyboard.press("Enter");
  const viewer = page.getByRole("dialog", { name: "Stone stairway" });
  await expect(viewer).toBeVisible();
  await expect(viewer.getByRole("img", { name: "Stone stairway" })).toHaveAttribute("src", /media\/17654151284\/18f6e2e4f52a67c7\.jpg$/);
  await expect(viewer).toContainText("The long stone stairway through the hillside woods. Autumn leaves on every tread.");
  await expect(viewer).not.toContainText("Editorial");
  await expect(viewer.getByRole("button", { name: "Close photo" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  // Escape closed the photo, not the town.
  await expect(page).toHaveURL(/#\/lab\/overland\/town\/kyoto-japan/);
  await expect(polaroids.first()).toBeFocused();
});

/** Seeks to `metresBefore` short of a distance, by the slider's percent of the route. */
async function seekBefore(page: Page, atM: number, totalM: number, metresBefore: number) {
  const percent = (((atM - metresBefore) / totalM) * 100).toFixed(1);
  await slider(page).fill(percent);
}

test("in the 3D world, her moment appears when the runner reaches it, its photo opens and pauses, then it tucks away", async ({ page }) => {
  await installGoogleReplay(page, "ready");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/#/lab/overland/town/kyoto-japan/${PEACH.slug}/3d?quality=low`);
  await expect(page.getByTestId("overland-jump")).toHaveAttribute("data-jump-phase", "realm", { timeout: 40_000 });
  const total = Number(await page.getByTestId("overland-realm-text").textContent().then((text) => /\/ ([\d.]+) km/.exec(text ?? "")?.[1])) * 1000;
  await seekBefore(page, 7572, total, 60);
  await expect(slider(page)).toHaveAttribute("data-moment-phase", "approaching");
  await expect(slider(page)).toHaveAttribute("data-moment-phase", "showing", { timeout: 20_000 });
  const moment = page.getByTestId("overland-moment");
  await expect(moment).toBeVisible();
  await expect(page.getByTestId("overland-moment-text")).toHaveText("Photo at 7.6 km. Stone stairway. The long stone stairway through the hillside woods. Autumn leaves on every tread.");
  // Nothing of ours over the attribution band.
  const rect = (await moment.boundingBox())!;
  expect(rect.y + rect.height).toBeLessThanOrEqual(844 - 36);

  await moment.getByRole("button", { name: "Open photo: Stone stairway" }).click();
  await expect(slider(page)).toHaveAttribute("data-moment-phase", "mediaOpen");
  const viewer = page.getByRole("dialog", { name: "Stone stairway" });
  await expect(viewer).toBeVisible();
  const held = await slider(page).inputValue();
  await page.waitForTimeout(1200);
  expect(await slider(page).inputValue()).toBe(held);
  // Escape closes the photo and the 3D world stays.
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  await expect(page.getByTestId("overland-jump")).toHaveAttribute("data-jump-phase", "realm");
  await expect(moment).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
});

test("scrubbing back before a moment brings it back; scrubbing forward past one skips it", async ({ page }) => {
  await installGoogleReplay(page, "ready");
  await page.goto(`/#/lab/overland/town/kyoto-japan/${PEACH.slug}/3d?quality=low`);
  await expect(page.getByTestId("overland-jump")).toHaveAttribute("data-jump-phase", "realm", { timeout: 40_000 });
  await slider(page).fill("60");
  await page.waitForTimeout(500);
  await expect(page.getByTestId("overland-moment")).toHaveCount(0);
  await slider(page).fill("35.4");
  await expect(slider(page)).toHaveAttribute("data-moment-phase", "showing", { timeout: 20_000 });
  await page.getByRole("button", { name: "Put this moment away" }).click();
  await expect(page.getByTestId("overland-moment")).toHaveCount(0);
});

test("an editorial moment says so, in the box and to a screen reader", async ({ page }) => {
  await installGoogleReplay(page, "ready");
  await withEditorialMoment(page);
  await page.goto(`/#/lab/overland/town/kyoto-japan/${GOLD.slug}/3d?quality=low`);
  await expect(page.getByTestId("overland-jump")).toHaveAttribute("data-jump-phase", "realm", { timeout: 40_000 });
  const total = Number(await page.getByTestId("overland-realm-text").textContent().then((text) => /\/ ([\d.]+) km/.exec(text ?? "")?.[1])) * 1000;
  await seekBefore(page, 1500, total, 40);
  await expect(slider(page)).toHaveAttribute("data-moment-phase", "showing", { timeout: 20_000 });
  await expect(page.getByTestId("overland-moment-text")).toHaveText("Note at 1.5 km, editorial. Fixture title. Fixture body.");
  await expect(page.getByTestId("overland-moment").getByRole("button", { name: /Open photo/ })).toHaveCount(0);
});

test("with reduced motion a moment appears without sliding in", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installGoogleReplay(page, "ready");
  await withEditorialMoment(page);
  await page.goto(`/#/lab/overland/town/kyoto-japan/${GOLD.slug}/3d?quality=low`);
  await expect(page.getByTestId("overland-jump")).toHaveAttribute("data-jump-phase", "realm", { timeout: 40_000 });
  // Reduced motion does not start playing; play, then meet the first moment.
  await slider(page).fill("4.4");
  await page.getByRole("button", { name: "Play" }).click();
  await expect(slider(page)).toHaveAttribute("data-moment-phase", "showing", { timeout: 20_000 });
  await expect(page.getByTestId("overland-moment")).toHaveCSS("animation-name", "none");
});
