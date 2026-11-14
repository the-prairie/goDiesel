import { expect, test, type Page } from "@playwright/test";

import { installGoogleReplay } from "./helpers/google-replay";

// The 3D town: one of her places as a pixel diorama, a signpost per route,
// and the jump from a signpost into the route's 3D world and back. The fake
// Google engine stands in for the map. `?quality=low` keeps the software
// renderer in CI quick; the quality tiers are unit tested.

const KYOTO = { slug: "kyoto-japan", name: "Kyoto, Japan" };
const GOLD = { slug: "17636880071", title: "i love goooooooolddddddddd", number: "064" };
const PEACH = { slug: "17654151284", title: "🍑🍑🍑🍑💦💦💦💦", number: "065" };

declare global {
  interface Window {
    __townPhases?: () => string[];
    __townStage?: Array<{ phase: string; opacity: string; clip: string }>;
    __GODIESEL_SET_PROVIDER_STATUS__?: (state: "ready" | "loading" | "unavailable") => void;
  }
}

const town = (page: Page) => page.getByTestId("overland-town");
const jump = (page: Page) => page.getByTestId("overland-jump");
// The town's camera breathes, so signposts drift by a pixel or two: clicks do not wait for them to settle.
const sign = (page: Page, number: string) => page.getByTestId("overland-town-signs").getByRole("button", { name: new RegExp(`^No\\. ${number}:`) });

async function openTown(page: Page, query = "?quality=low") {
  await page.goto(`/#/lab/overland/town/${KYOTO.slug}${query}`);
  await expect(town(page)).toHaveAttribute("data-town-phase", "ready", { timeout: 30_000 });
}

/** Records every jump phase, and the town layer's opacity and clip at each. */
async function recordTownJump(page: Page) {
  await page.evaluate(() => {
    const seen: string[] = [];
    window.__townStage = [];
    const sample = () => {
      const phase = document.querySelector<HTMLElement>("[data-jump-phase]")?.dataset.jumpPhase;
      const stage = document.querySelector<HTMLElement>("[data-testid=overland-town-stage]");
      if (!phase || !stage) return;
      if (seen.at(-1) !== phase) seen.push(phase);
      window.__townStage!.push({ phase, opacity: stage.style.opacity, clip: stage.style.clipPath });
    };
    new MutationObserver(sample).observe(document.body, { subtree: true, attributes: true, childList: true, attributeFilter: ["data-jump-phase", "style"] });
    window.__townPhases = () => [...seen];
  });
}

test("Open on the world map enters the chosen town in 3D, with a signpost for each route", async ({ page }) => {
  await page.goto(`/#/lab/overland?town=${encodeURIComponent(KYOTO.name)}`);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#/lab/overland/town/${KYOTO.slug}$`));
  await expect(town(page)).toHaveAttribute("data-town-phase", "ready", { timeout: 30_000 });
  await expect(town(page)).toHaveAttribute("data-town-biome", "japan");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Kyoto, Japan, 2 routes");
  const signs = page.getByTestId("overland-town-signs");
  await expect(signs).toHaveAttribute("aria-label", "Routes in Kyoto, Japan");
  await expect(signs.getByRole("button")).toHaveCount(2);
  // Her titles exactly, emoji included.
  await expect(sign(page, GOLD.number)).toHaveAccessibleName(new RegExp(GOLD.title));
  await expect(sign(page, PEACH.number)).toHaveAccessibleName(new RegExp(PEACH.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  // Back returns to the world with the town still chosen.
  await page.getByRole("button", { name: "Back to the world map" }).click();
  await expect(page).toHaveURL(/town=Kyoto/);
});

test("choosing a signpost lights the town at the hour that run started there", async ({ page }) => {
  await openTown(page);
  await expect(town(page)).toHaveAttribute("data-light", "golden");
  // Her peach run started at 06:54 in Japan.
  await sign(page, PEACH.number).focus();
  await expect(town(page)).toHaveAttribute("data-light", "dawn");
  await expect(page.getByTestId("overland-town-box")).toBeVisible();
  await page.getByTestId("overland-town-canvas").focus();
  await expect(town(page)).toHaveAttribute("data-light", "golden");
});

test("a signpost dives into its route; the town holds with her running until the scene is ready, then fades with the attribution band clear", async ({ page }) => {
  // The town is drawn by the CPU on a CI runner without a GPU: give the whole journey room.
  test.setTimeout(90_000);
  await installGoogleReplay(page, "loading");
  await page.setViewportSize({ width: 1440, height: 900 });
  await openTown(page);
  await recordTownJump(page);
  await sign(page, GOLD.number).click({ force: true });
  await expect(page).toHaveURL(new RegExp(`#/lab/overland/town/${KYOTO.slug}/${GOLD.slug}/3d$`));
  await expect(jump(page)).toHaveAttribute("data-transition", "town");
  await expect(jump(page)).toHaveAttribute("data-jump-phase", "holding", { timeout: 10_000 });
  // The hold is travel, not a message: only a way to cancel.
  await expect(page.getByTestId("overland-jump-travel").getByRole("button", { name: "Cancel" })).toBeVisible();
  await expect(page.getByTestId("overland-jump-status")).toHaveCount(0);

  await page.evaluate(() => window.__GODIESEL_SET_PROVIDER_STATUS__?.("ready"));
  await expect(jump(page)).toHaveAttribute("data-jump-phase", "realm", { timeout: 30_000 });
  expect(await page.evaluate(() => window.__townPhases?.())).toEqual(["diving", "holding", "resolving", "realm"]);
  const stage = await page.evaluate(() => window.__townStage ?? []);
  const resolving = stage.filter((sample) => sample.phase === "resolving");
  expect(resolving.length).toBeGreaterThan(0);
  // While the live map shows under the town, Google's band is never covered.
  for (const sample of resolving) if (Number(sample.opacity) > 0) expect(sample.clip).toBe("inset(0px 0px 36px)");
  for (const sample of stage.filter((entry) => entry.phase === "diving" || entry.phase === "holding")) expect(sample.opacity).toBe("1");
  await expect(page.getByTestId("overland-town-stage")).toHaveCSS("visibility", "hidden");

  // The runner in 3D is the town's runner.
  const marker = page.getByTestId("replay-position-marker");
  await expect(marker).toHaveAttribute("data-marker-kind", "overland-sprite");
  await expect(marker.locator("img")).toHaveAttribute("height", "96");
  await expect(page.getByTestId("overland-realm-text")).toContainText(GOLD.title);
  // The provider credit is on top where it sits, and still works.
  const credit = page.getByRole("button", { name: "Provider information fixture" });
  const box = (await credit.boundingBox())!;
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.textContent, [box.x + box.width / 2, box.y + box.height / 2])).toBe("Provider information fixture");

  // Leaving returns to the same town, focused on the same signpost.
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(new RegExp(`#/lab/overland/town/${KYOTO.slug}\\?quality=low$`));
  await expect(jump(page)).toHaveCount(0);
  await expect(sign(page, GOLD.number)).toBeFocused();
  await expect(page.getByTestId("overland-town-stage")).toHaveCSS("opacity", "1");
});

test("the town works from the keyboard alone: arrows between signposts, Enter jumps, Escape returns", async ({ page }) => {
  // The town is drawn by the CPU on a CI runner without a GPU: give the whole journey room.
  test.setTimeout(90_000);
  await installGoogleReplay(page, "ready");
  await openTown(page);
  await sign(page, GOLD.number).focus();
  await page.keyboard.press("ArrowRight");
  await expect(sign(page, PEACH.number)).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(sign(page, GOLD.number)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(jump(page)).toHaveAttribute("data-jump-phase", "realm", { timeout: 30_000 });
  await page.keyboard.press("Escape");
  await expect(jump(page)).toHaveCount(0);
  await expect(sign(page, GOLD.number)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/#\/lab\/overland\?town=Kyoto/);
});

test("with reduced motion the jump from a town cuts: no dive and no steps", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installGoogleReplay(page, "ready");
  await openTown(page);
  await recordTownJump(page);
  await sign(page, PEACH.number).click({ force: true });
  await expect(jump(page)).toHaveAttribute("data-jump-phase", "realm");
  const seen = (await page.evaluate(() => window.__townPhases?.())) ?? [];
  expect(seen).not.toContain("diving");
  expect(seen).not.toContain("resolving");
});

test("a deep link to a route's 3D world from a town opens it directly, and leaving lands on its signpost", async ({ page }) => {
  // The town is drawn by the CPU on a CI runner without a GPU: give the whole journey room.
  test.setTimeout(90_000);
  await installGoogleReplay(page, "ready");
  await page.goto(`/#/lab/overland/town/${KYOTO.slug}/${PEACH.slug}/3d?quality=low`);
  // The town is built under the 3D world, which the software renderer takes a while over.
  await expect(jump(page)).toHaveAttribute("data-jump-phase", "realm", { timeout: 40_000 });
  await expect(jump(page)).toHaveAttribute("data-entrance", "direct");
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(new RegExp(`#/lab/overland/town/${KYOTO.slug}\\?sign=${PEACH.slug}$`));
  await expect(sign(page, PEACH.number)).toBeFocused({ timeout: 15_000 });
});

test("when the scene cannot open, she stays in the town and a plain message offers the way back", async ({ page }) => {
  await installGoogleReplay(page, "unavailable");
  await openTown(page);
  await sign(page, GOLD.number).click({ force: true });
  await expect(jump(page)).toHaveAttribute("data-jump-phase", "fallback");
  await expect(page.getByTestId("overland-jump-fallback")).toContainText("The 3D view isn't available right now.");
  await expect(page.getByTestId("overland-town-stage")).toHaveCSS("opacity", "1");
  await page.getByTestId("overland-jump-fallback").getByRole("button", { name: "Back", exact: true }).click();
  await expect(jump(page)).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`#/lab/overland/town/${KYOTO.slug}`));
});

test("without WebGL the town falls back to its pixel index, with no dead end", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
      if (kind === "webgl" || kind === "webgl2" || kind === "experimental-webgl") return null;
      return (original as (...args: unknown[]) => unknown).call(this, kind, ...rest);
    } as typeof original;
  });
  await page.goto(`/#/lab/overland/town/${KYOTO.slug}`);
  await expect(page.getByTestId("overland-town-fallback")).toContainText("The 3D town isn't available right now.");
  const index = page.getByTestId("overland-index");
  await expect(index.getByRole("button")).toHaveCount(2);
  await index.getByRole("button", { name: new RegExp(GOLD.title) }).click();
  await expect(page.getByTestId("overland-entry").getByRole("heading", { level: 1 })).toHaveText(GOLD.title);
});

test("when the town's renderer chunk cannot load, the town falls back to its pixel index", async ({ page }) => {
  await page.route(/town-renderer-.*\.js$/, (route) => route.abort());
  await page.goto(`/#/lab/overland/town/${KYOTO.slug}`);
  await expect(page.getByTestId("overland-town-fallback")).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to the world map" })).toBeVisible();
});

test("the town loads three.js only when a town opens, and frees its WebGL context on leave", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("/#/lab/overland");
  await expect(page.getByTestId("overland-world")).toBeVisible();
  expect(requests.some((url) => /town-renderer-/.test(url))).toBe(false);
  await page.goto(`/#/lab/overland/town/${KYOTO.slug}?quality=low`);
  await expect(town(page)).toHaveAttribute("data-town-phase", "ready", { timeout: 30_000 });
  expect(requests.some((url) => /town-renderer-/.test(url))).toBe(true);
  await page.evaluate(() => {
    (window as Window & { __townCanvas?: HTMLCanvasElement }).__townCanvas = document.querySelector<HTMLCanvasElement>("[data-testid=overland-town-canvas]")!;
  });
  await page.getByRole("button", { name: "Back to the world map" }).click();
  await expect(page.getByTestId("overland-world")).toBeVisible();
  expect(
    await page.evaluate(() => {
      const canvas = (window as Window & { __townCanvas?: HTMLCanvasElement }).__townCanvas!;
      const context = canvas.getContext("webgl2");
      return { attached: canvas.isConnected, lost: context === null || context.isContextLost() };
    }),
  ).toEqual({ attached: false, lost: true });
});

for (const [width, height] of [[390, 844], [1440, 900]] as const) {
  test(`the town fits ${width}px by touch: no horizontal scroll, signposts and keys at least 44px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    // With reduced motion the town draws only when something changes, which
    // keeps the software renderer from saturating the page at desktop size.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openTown(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    // On a phone the signposts are chips in a strip that scrolls sideways; the strip itself fits.
    const strip = (await page.getByTestId("overland-town-signs").boundingBox())!;
    expect(strip.x).toBeGreaterThanOrEqual(0);
    expect(strip.x + strip.width).toBeLessThanOrEqual(width);
    for (const button of await page.getByTestId("overland-town-signs").getByRole("button").all()) {
      const box = (await button.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      if (width >= 768) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
      }
    }
    const back = (await page.getByRole("button", { name: "Back to the world map" }).boundingBox())!;
    expect(back.height).toBeGreaterThanOrEqual(44);
  });
}

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

  test("each route is a chip with its number and title in thumb reach; the first tap chooses, the second enters", async ({ page }) => {
    await installGoogleReplay(page, "loading");
    await page.goto("/#/lab/overland/town/crete-greece?quality=low");
    await expect(town(page)).toHaveAttribute("data-town-phase", "ready", { timeout: 30_000 });
    const chips = page.getByTestId("overland-town-signs").getByRole("button");
    await expect(chips).toHaveCount(8);
    for (const chip of await chips.all()) {
      const box = (await chip.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
      // In thumb reach: the bottom of the screen.
      expect(box.y).toBeGreaterThan(812 * 0.6);
    }
    // The names are unchanged, so screen readers and keys work as before.
    const third = chips.nth(2);
    await expect(third).toHaveAccessibleName(/^No\. \d{3}: .+ Jump into the 3D world\.$/);
    const url = page.url();
    await third.tap();
    await expect(third).toHaveAttribute("data-chosen", "true");
    expect(page.url()).toBe(url);
    await expect(page.locator(".overland-town-pointer")).toBeVisible();
    await expect(page.getByTestId("overland-town-box")).toBeVisible();
    await third.tap();
    await expect(page).toHaveURL(/\/3d$/);
  });

  test("a tap on a board in the scene chooses its chip", async ({ page }) => {
    await page.goto("/#/lab/overland/town/kyoto-japan?quality=low");
    await expect(town(page)).toHaveAttribute("data-town-phase", "ready", { timeout: 30_000 });
    const board = await page.evaluate(() => {
      const signs = (window as Window & { __overlandTown?: { signs: () => Array<{ slug: string; x: number; y: number; visible: boolean }> } }).__overlandTown!.signs();
      return signs.find((sign) => sign.visible)!;
    });
    await page.touchscreen.tap(board.x, board.y);
    await expect(page.locator(`.overland-town-sign[data-slug="${board.slug}"]`)).toHaveAttribute("data-chosen", "true");
    await expect(page).toHaveURL(/kyoto-japan\?quality=low$/);
  });

  test("a chip still enters from the keyboard", async ({ page }) => {
    await installGoogleReplay(page, "ready");
    await page.goto("/#/lab/overland/town/kyoto-japan?quality=low");
    await expect(town(page)).toHaveAttribute("data-town-phase", "ready", { timeout: 30_000 });
    await sign(page, GOLD.number).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`${GOLD.slug}/3d$`));
  });
});
