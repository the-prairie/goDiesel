import { expect, test, type Page } from "@playwright/test";

import { installGoogleReplay } from "./helpers/google-replay";

// The Overland jump: from a route's entry into its 3D world under our pixel
// cover, and back. The fake Google engine stands in for the map; its
// provider credit sits in the bottom-right corner, as Google's does.

const KYOTO = "Kyoto, Japan";
const GOLD = { slug: "17636880071", title: "i love goooooooolddddddddd" };

declare global {
  interface Window {
    __overlandPhases?: () => string[];
    __overlandCornerAlpha?: Array<{ coverage: string; alpha: number }>;
    __GODIESEL_SET_PROVIDER_STATUS__?: (state: "ready" | "loading" | "unavailable") => void;
    __GODIESEL_GOOGLE_MOUNTS__?: number;
  }
}

/**
 * Records every phase the jump shows, in order, and samples the cover's
 * attribution corners each time its coverage changes.
 */
async function recordJump(page: Page) {
  await page.evaluate(() => {
    const seen: string[] = [];
    const push = (phase: string | null) => {
      if (phase && seen.at(-1) !== phase) seen.push(phase);
    };
    window.__overlandCornerAlpha = [];
    const sampleCorners = (cover: HTMLCanvasElement) => {
      const context = cover.getContext("2d");
      if (!context || cover.dataset.liveMap !== "true") return;
      const band = Number(cover.dataset.cornerHeight);
      const top = cover.height - band;
      const pixels = context.getImageData(0, top, cover.width, band).data;
      let alpha = 0;
      for (let index = 3; index < pixels.length; index += 4) alpha += pixels[index];
      window.__overlandCornerAlpha!.push({ coverage: cover.dataset.coverCoverage ?? "", alpha });
    };
    new MutationObserver((records) => {
      for (const record of records) {
        const target = record.target as HTMLElement;
        if (record.type === "attributes" && record.attributeName === "data-jump-phase") push(record.oldValue);
        if (record.type === "attributes" && target.dataset.testid === "overland-jump-cover") sampleCorners(target as HTMLCanvasElement);
        // A jump that ends is removed in its last phase.
        for (const node of record.removedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          const jump = node.matches("[data-jump-phase]") ? node : node.querySelector<HTMLElement>("[data-jump-phase]");
          if (jump) push(jump.dataset.jumpPhase ?? null);
        }
      }
    }).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeOldValue: true,
      attributeFilter: ["data-jump-phase", "data-cover-coverage", "data-live-map"],
    });
    window.__overlandPhases = () => {
      const current = document.querySelector<HTMLElement>("[data-jump-phase]")?.dataset.jumpPhase ?? null;
      const all = [...seen];
      if (current && all.at(-1) !== current) all.push(current);
      return all;
    };
  });
}

const phases = (page: Page) => page.evaluate(() => window.__overlandPhases?.() ?? []);
const jump = (page: Page) => page.getByTestId("overland-jump");

async function openEntry(page: Page, slug = GOLD.slug) {
  await page.goto(`/#/lab/overland/${slug}`);
  await expect(page.getByTestId("overland-entry")).toBeVisible();
}

async function coverIsClear(page: Page) {
  return page.getByTestId("overland-jump-cover").evaluate((cover: HTMLCanvasElement) => {
    if (cover.hidden || getComputedStyle(cover).display === "none") return true;
    const pixels = cover.getContext("2d")!.getImageData(0, 0, cover.width, cover.height).data;
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index] !== 0) return false;
    return true;
  });
}

test("Enter dives into the route, holds until the scene is ready, then wipes to the 3D world", async ({ page }) => {
  await installGoogleReplay(page, "loading");
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEntry(page);
  // Browsing never mounts the map.
  expect(await page.evaluate(() => window.__GODIESEL_GOOGLE_MOUNTS__ ?? 0)).toBe(0);
  await expect(page.locator("[data-renderer=google-production]")).toHaveCount(0);
  await recordJump(page);

  await page.getByRole("button", { name: "Enter route", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#/lab/overland/${GOLD.slug}/3d$`));
  await expect(jump(page)).toHaveAttribute("data-jump-phase", "holding");
  await expect(page.getByTestId("overland-jump-status")).toHaveText("Loading the 3D view.");
  expect(await page.evaluate(() => window.__GODIESEL_GOOGLE_MOUNTS__)).toBe(1);

  await page.evaluate(() => window.__GODIESEL_SET_PROVIDER_STATUS__?.("ready"));
  await expect(jump(page)).toHaveAttribute("data-jump-phase", "realm");
  expect(await phases(page)).toEqual(["browsing", "diving", "holding", "resolving", "realm"]);
  await expect(jump(page)).toHaveAttribute("data-pixel-level", "1");
  await expect.poll(() => coverIsClear(page)).toBe(true);

  // While the live map showed, the attribution corners were never covered.
  const corners = await page.evaluate(() => window.__overlandCornerAlpha ?? []);
  expect(corners.length).toBeGreaterThanOrEqual(7);
  expect(corners.filter((sample) => Number(sample.coverage) > 0).length).toBeGreaterThanOrEqual(6);
  expect(corners.every((sample) => sample.alpha === 0)).toBe(true);

  const marker = page.getByTestId("replay-position-marker");
  await expect(marker).toHaveAttribute("data-marker-kind", "overland-sprite");
  await expect(marker.locator("img")).toHaveCount(1);

  const text = page.getByTestId("overland-realm-text");
  await expect(text).toContainText("No. ");
  await expect(text).toContainText(GOLD.title);
  await expect(text).toContainText(/\d+\.\d \/ \d+\.\d km/);
});

for (const [width, height] of [[390, 844], [1440, 900]] as const) {
  test(`the text box and controls keep clear of the attribution corners at ${width}px`, async ({ page }) => {
    await installGoogleReplay(page, "ready");
    await page.setViewportSize({ width, height });
    await page.goto(`/#/lab/overland/${GOLD.slug}/3d`);
    await expect(jump(page)).toHaveAttribute("data-jump-phase", "realm");

    const band = 32;
    const corners = [
      { x: 0, y: height - band, width: width / 2, height: band },
      { x: width / 2, y: height - band, width: width / 2, height: band },
    ];
    const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
      a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    for (const testId of ["overland-realm-text-box", "overland-realm-controls"]) {
      const box = (await page.getByTestId(testId).boundingBox())!;
      for (const corner of corners) expect(overlaps(box, corner), `${testId} over a corner`).toBe(false);
    }
    // The provider credit is on top where it sits, and still works.
    const credit = page.getByRole("button", { name: "Provider information fixture" });
    const creditBox = (await credit.boundingBox())!;
    const topmost = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.textContent,
      [creditBox.x + creditBox.width / 2, creditBox.y + creditBox.height / 2],
    );
    expect(topmost).toBe("Provider information fixture");

    // The entry beneath is inert while the 3D world is open.
    await expect(page.getByTestId("overland")).toHaveAttribute("inert", "");
    const controls = page.getByTestId("overland-realm-controls");
    for (const name of ["Back", "Pause", "Route progress"]) {
      const box = (await controls.getByRole(name === "Route progress" ? "slider" : "button", { name, exact: true }).boundingBox())!;
      expect(box.height, name).toBeGreaterThanOrEqual(44);
    }
    const overflow = await page.evaluate(() => ({
      x: document.documentElement.scrollWidth - window.innerWidth,
      y: document.documentElement.scrollHeight - window.innerHeight,
    }));
    expect(overflow.x).toBeLessThanOrEqual(0);
    expect(overflow.y).toBeLessThanOrEqual(0);
    // A deep link opens without the dive.
    expect(await page.evaluate(() => document.querySelector("[data-jump-phase]")?.getAttribute("data-entrance"))).toBe("direct");
  });
}

test("with reduced motion the jump is a crossfade: no dive, no wipe, no walk", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installGoogleReplay(page, "ready");
  await openEntry(page);
  await recordJump(page);
  await page.getByRole("button", { name: "Enter route", exact: true }).click();
  await expect(jump(page)).toHaveAttribute("data-jump-phase", "realm");
  const seen = await phases(page);
  expect(seen).not.toContain("diving");
  expect(seen).not.toContain("resolving");
  await expect.poll(() => coverIsClear(page)).toBe(true);

  const frame = () => page.getByTestId("replay-position-marker").locator("img").getAttribute("data-frame");
  const first = await frame();
  await page.getByRole("slider", { name: "Route progress" }).fill("37");
  expect(await frame()).toBe(first);

  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(new RegExp(`#/lab/overland/${GOLD.slug}$`));
  expect(await phases(page)).not.toContain("resolving");
});

test("Escape leaves the way it came, back to the same entry, and Back returns to the town", async ({ page }) => {
  await installGoogleReplay(page, "ready");
  await page.goto(`/#/lab/overland?town=${encodeURIComponent(KYOTO)}&view=index`);
  await page.getByTestId("overland-index").getByRole("button", { name: new RegExp(GOLD.title) }).click();
  await expect(page.getByTestId("overland-entry")).toBeVisible();
  await recordJump(page);
  await page.getByRole("button", { name: "Enter route", exact: true }).click();
  await expect(jump(page)).toHaveAttribute("data-jump-phase", "realm");

  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(new RegExp(`#/lab/overland/${GOLD.slug}$`));
  await expect(jump(page)).toHaveCount(0);
  expect((await phases(page)).slice(-2)).toEqual(["surfacing", "browsing"]);
  await expect(page.getByTestId("overland-entry").getByRole("heading", { level: 1 })).toHaveText(GOLD.title);
  await expect(page.getByRole("button", { name: "Enter route", exact: true })).toBeFocused();

  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByTestId("overland-index")).toBeVisible();
  await expect(page).toHaveURL(/town=Kyoto/);
});

test("any key during the wipe skips to the 3D world", async ({ page }) => {
  await installGoogleReplay(page, "loading");
  await openEntry(page);
  await page.getByRole("button", { name: "Enter route", exact: true }).click();
  await expect(jump(page)).toHaveAttribute("data-jump-phase", "holding");
  await page.evaluate(() => window.__GODIESEL_SET_PROVIDER_STATUS__?.("ready"));
  await page.waitForFunction(() => document.querySelector("[data-jump-phase]")?.getAttribute("data-jump-phase") === "resolving", null, { polling: "raf" });
  await page.keyboard.press("x");
  await expect(jump(page)).toHaveAttribute("data-jump-phase", "realm");
  await expect.poll(() => coverIsClear(page)).toBe(true);
});

test("play, pause and scrub from the keyboard, and the runner walks with the replay", async ({ page }) => {
  await installGoogleReplay(page, "ready");
  await page.goto(`/#/lab/overland/${GOLD.slug}/3d`);
  await expect(jump(page)).toHaveAttribute("data-jump-phase", "realm");
  const play = page.getByRole("button", { name: /^(Play|Pause)$/ });
  await expect(play).toHaveAccessibleName("Pause");
  await page.keyboard.press("Space");
  await expect(play).toHaveAccessibleName("Play");
  const slider = page.getByRole("slider", { name: "Route progress" });
  const before = Number(await slider.inputValue());
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => Number(await slider.inputValue())).toBeGreaterThan(before);

  const img = page.getByTestId("replay-position-marker").locator("img");
  const frames = new Set<string>();
  for (const value of ["10", "10.4", "10.8", "11.2"]) {
    await slider.fill(value);
    frames.add((await img.getAttribute("data-frame")) ?? "");
  }
  expect(frames.size).toBeGreaterThan(1);
});

test("when the 3D world cannot open, a plain message offers the way back", async ({ page }) => {
  await installGoogleReplay(page, "unavailable");
  await page.setViewportSize({ width: 390, height: 844 });
  await openEntry(page);
  await page.getByRole("button", { name: "Enter route", exact: true }).click();
  await expect(jump(page)).toHaveAttribute("data-jump-phase", "fallback");
  const fallback = page.getByTestId("overland-jump-fallback");
  await expect(fallback).toContainText("The 3D view isn't available right now.");
  // The drawn message wraps rather than running under the key on a phone.
  const key = (await fallback.getByRole("button", { name: "Back", exact: true }).boundingBox())!;
  for (const line of await fallback.locator(".overland-jump-status-text canvas").all()) {
    const box = (await line.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(key.x);
  }
  await page.getByTestId("overland-jump-fallback").getByRole("button", { name: "Back", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#/lab/overland/${GOLD.slug}$`));
  await expect(page.getByTestId("overland-entry")).toBeVisible();
});
