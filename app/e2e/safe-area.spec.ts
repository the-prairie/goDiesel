import { expect, test, type Locator, type Page } from "@playwright/test";
import { installDeterministicCesiumAtlas } from "./helpers/deterministic-atlas";
import { installGoogleReplay } from "./helpers/google-replay";

// Surface-owned edge bars clear the safe-area insets. Chromium reports 0 for
// env(safe-area-inset-*), so these tests simulate an iPhone by overriding the
// shell's --safe-area-* tokens (index.css), which every inset rule reads.
// With the tokens at 0 every box is unchanged; that is what the other specs
// (and the navigation screenshots) cover.

type Insets = { top: number; right: number; bottom: number; left: number };
type Orientation = { name: string; viewport: { width: number; height: number }; insets: Insets };

const PORTRAIT: Orientation = {
  name: "portrait",
  viewport: { width: 390, height: 844 },
  insets: { top: 59, right: 0, bottom: 34, left: 0 },
};
const LANDSCAPE: Orientation = {
  name: "landscape",
  viewport: { width: 844, height: 390 },
  insets: { top: 0, right: 59, bottom: 21, left: 59 },
};
const BOTH = [PORTRAIT, LANDSCAPE];

const courseId = "course-213a0076-6d18-5be9-9fb2-7a772888c6b5";
const savedCourse = {
  id: courseId,
  name: "Calgary saved course",
  description: "",
  activity: "Run",
  createdAt: "2026-10-21T07:00:00Z",
  source: { kind: "gpx", filename: "course.gpx" },
  warnings: [],
  segments: [[
    { lat: 51.04, lng: -114.05, elevationM: 1_050 },
    { lat: 51.05, lng: -114.05, elevationM: 1_060 },
  ]],
};

/** A one-source map style, so MapLibre's attribution renders without tiles. */
async function stubMapStyle(page: Page) {
  await page.route("**/styles/liberty", (route) => route.fulfill({ json: {
    version: 8,
    sources: { credits: {
      type: "geojson", data: { type: "FeatureCollection", features: [] },
      attribution: '<a href="https://openfreemap.org">OpenFreeMap</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    } },
    layers: [{ id: "background", type: "background", paint: { "background-color": "#d9ddd2" } }, { id: "credits", type: "line", source: "credits" }],
  } }));
}

async function open(page: Page, orientation: Orientation, path: string) {
  await page.setViewportSize(orientation.viewport);
  await page.goto(path);
  await page.evaluate((insets) => {
    for (const [edge, value] of Object.entries(insets))
      document.documentElement.style.setProperty(`--safe-area-${edge}`, `${value}px`);
  }, orientation.insets);
}

type Check = {
  offenders: string[];
  smallTargets: string[];
  overflow: number;
};

/**
 * Every visible control and every piece of text inside `roots` lies outside
 * the inset strips, interactive elements are at least 44x44, and the page has
 * no horizontal overflow. Content inside a scroll container is judged where it
 * rests at the scroll extremes (the container's content box), because content
 * may scroll under the home indicator as long as its end can scroll clear.
 */
async function checkEdgeBars(page: Page, roots: string[], insets: Insets, edges = ["top", "right", "bottom", "left"]): Promise<Check> {
  return page.evaluate(({ roots, insets, edges }) => {
    const W = innerWidth;
    const H = innerHeight;
    const interactive = "a[href],button,input:not([type=hidden]),select,textarea,[role=slider],[role=button],[role=tab]";
    const px = (value: string) => parseFloat(value) || 0;
    const visibleBox = (el: Element) => {
      const rect = el.getBoundingClientRect();
      let box = { l: rect.left, t: rect.top, r: rect.right, b: rect.bottom };
      for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
        const ar = a.getBoundingClientRect();
        const scrolls = a.scrollHeight > a.clientHeight + 1 || a.scrollWidth > a.clientWidth + 1;
        const pad = scrolls
          ? { l: px(cs.borderLeftWidth) + px(cs.paddingLeft), t: px(cs.borderTopWidth) + px(cs.paddingTop), r: px(cs.borderRightWidth) + px(cs.paddingRight), b: px(cs.borderBottomWidth) + px(cs.paddingBottom) }
          : { l: px(cs.borderLeftWidth), t: px(cs.borderTopWidth), r: px(cs.borderRightWidth), b: px(cs.borderBottomWidth) };
        box = { l: Math.max(box.l, ar.left + pad.l), t: Math.max(box.t, ar.top + pad.t), r: Math.min(box.r, ar.right - pad.r), b: Math.min(box.b, ar.bottom - pad.b) };
      }
      box = { l: Math.max(box.l, 0), t: Math.max(box.t, 0), r: Math.min(box.r, W), b: Math.min(box.b, H) };
      return box.r - box.l >= 1 && box.b - box.t >= 1 ? box : null;
    };
    const seen = new Set<Element>();
    const offenders: string[] = [];
    const smallTargets: string[] = [];
    for (const selector of roots) {
      for (const root of document.querySelectorAll(selector)) {
        for (const el of [root, ...root.querySelectorAll("*")]) {
          if (seen.has(el)) continue;
          seen.add(el);
          const isInteractive = el.matches(interactive);
          const hasText = [...el.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
          if (!isInteractive && !hasText) continue;
          if (el.closest("[aria-hidden=true],[inert],.sr-only,[hidden]")) continue;
          if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
          const box = visibleBox(el);
          if (!box) continue;
          const name = (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 48);
          const hits = [];
          if (edges.includes("top") && box.t < insets.top - 0.5) hits.push("top");
          if (edges.includes("bottom") && box.b > H - insets.bottom + 0.5) hits.push("bottom");
          if (edges.includes("left") && box.l < insets.left - 0.5) hits.push("left");
          if (edges.includes("right") && box.r > W - insets.right + 0.5) hits.push("right");
          if (hits.length) offenders.push(`${hits.join("+")} inset: <${el.tagName.toLowerCase()}> "${name}"`);
          // Map providers style their inline credit links; a text field is
          // measured by its 44 px field, not the bare input.
          if (!isInteractive || el.matches("input[type=range]") || el.closest(".maplibregl-ctrl-attrib,.cesium-viewer-bottom")) continue;
          const rect = (el.matches("input") ? el.parentElement! : el).getBoundingClientRect();
          if (rect.width < 43.5 || rect.height < 43.5)
            smallTargets.push(`<${el.tagName.toLowerCase()}> "${name}" ${Math.round(rect.width)}x${Math.round(rect.height)}`);
        }
      }
    }
    return { offenders, smallTargets, overflow: document.documentElement.scrollWidth - W };
  }, { roots, insets, edges });
}

async function expectEdgeBarsClear(page: Page, orientation: Orientation, roots: string[], options: { edges?: string[]; targets?: boolean } = {}) {
  // The first root is the bar under test; the others may be absent in a state.
  await expect(page.locator(roots[0]).first()).toBeAttached();
  const result = await checkEdgeBars(page, roots, orientation.insets, options.edges);
  expect(result.offenders, `inside the ${orientation.name} insets`).toEqual([]);
  if (options.targets !== false) expect(result.smallTargets, "tap targets under 44x44").toEqual([]);
  expect(result.overflow, "horizontal page overflow").toBeLessThanOrEqual(0);
}

async function boxOf(locator: Locator) {
  await expect(locator).toBeVisible();
  return (await locator.boundingBox())!;
}

/**
 * No two of the given boxes overlap. A 1 px touch is allowed: the Atlas tray's
 * top border already sits 1 px over the credits above it, insets or not.
 */
async function expectApart(named: Record<string, Locator>) {
  const boxes = await Promise.all(Object.entries(named).map(async ([name, locator]) => [name, await boxOf(locator)] as const));
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const [a, ab] = boxes[i];
      const [b, bb] = boxes[j];
      const overlap = ab.x < bb.x + bb.width - 1.5 && bb.x < ab.x + ab.width - 1.5 && ab.y < bb.y + bb.height - 1.5 && bb.y < ab.y + ab.height - 1.5;
      expect(overlap, `${a} overlaps ${b}`).toBe(false);
    }
  }
}

for (const orientation of BOTH) {
  test.describe(`safe-area insets, phone ${orientation.name}`, () => {
    test("Replay's header and dock clear the insets", async ({ page }) => {
      await installGoogleReplay(page, "ready");
      await open(page, orientation, "/#/replay/14736711660");
      await expect(page.getByTestId("replay-stage")).toHaveAttribute("data-state", "ready");
      await expectEdgeBarsClear(page, orientation, ["[data-testid=replay-stage] header.replay-header", "[data-testid=replay-controls]"]);
      await expectApart({
        back: page.getByRole("button", { name: "All routes", exact: true }),
        settings: page.getByRole("button", { name: "Replay settings", exact: true }),
        dock: page.getByTestId("replay-controls"),
      });
    });

    test("Replay's unavailable card stays inside the safe area", async ({ page }) => {
      await installGoogleReplay(page, "unavailable");
      await open(page, orientation, "/#/replay/14736711660");
      await expect(page.getByRole("alert")).toBeVisible();
      await expectEdgeBarsClear(page, orientation, ["[data-testid=replay-stage] header.replay-header", "[data-testid=replay-stage] [role=alert]"]);
      await expectApart({ settings: page.getByRole("button", { name: "Replay settings", exact: true }), card: page.getByRole("alert") });
    });

    test("Replay's side sheets clear the insets", async ({ page }) => {
      await installGoogleReplay(page, "ready");
      await open(page, orientation, "/#/replay/14736711660");
      for (const [trigger, title] of [["Replay settings", "Replay settings"], ["Change route", "Choose a replay route"]]) {
        await page.getByRole("button", { name: trigger, exact: true }).click();
        const sheet = page.getByRole("dialog");
        await expect(sheet.getByRole("heading", { name: title })).toBeVisible();
        await expectEdgeBarsClear(page, orientation, ["[data-slot=sheet-content]"]);
        // The close button keeps clear of the title's text (the heading's box
        // runs under it by design; the header reserves pr-12 for it).
        const close = await boxOf(sheet.getByRole("button", { name: "Close", exact: true }));
        const titleText = await sheet.getByRole("heading", { name: title }).evaluate((heading) => {
          const range = document.createRange();
          range.selectNodeContents(heading);
          const rect = range.getBoundingClientRect();
          return { right: rect.right, top: rect.top, bottom: rect.bottom };
        });
        expect(titleText.right <= close.x || titleText.bottom <= close.y || titleText.top >= close.y + close.height, "Close overlaps the title").toBe(true);
        await page.keyboard.press("Escape");
        await expect(sheet).toBeHidden();
      }
    });

    test("the course preview's header, dock, settings and notice clear the insets", async ({ page }) => {
      await page.route(`**/api/courses?id=${courseId}`, (route) => route.fulfill({ json: { course: savedCourse } }));
      await installGoogleReplay(page, "ready");
      await open(page, orientation, `/#/courses/${courseId}/preview`);
      await expect(page.getByTestId("course-preview-stage")).toHaveAttribute("data-state", "ready");
      await expectEdgeBarsClear(page, orientation, ["[data-testid=course-preview-stage] header", "[data-testid=course-preview-controls]"]);
      await expectApart({
        back: page.getByRole("link", { name: "Back to course", exact: true }),
        title: page.getByRole("heading", { name: savedCourse.name }),
        dock: page.getByTestId("course-preview-controls"),
      });
      await page.getByRole("button", { name: "Preview settings", exact: true }).click();
      await expect(page.getByRole("dialog").getByRole("heading", { name: "Preview settings" })).toBeVisible();
      await expectEdgeBarsClear(page, orientation, ["[data-slot=sheet-content]"]);
    });

    test("the course preview's unavailable notice stays inside the safe area", async ({ page }) => {
      await page.route(`**/api/courses?id=${courseId}`, (route) => route.fulfill({ json: { course: savedCourse } }));
      await installGoogleReplay(page, "unavailable");
      await open(page, orientation, `/#/courses/${courseId}/preview`);
      await expect(page.getByRole("alert")).toBeVisible();
      await expectEdgeBarsClear(page, orientation, ["[data-testid=course-preview-stage] header", "[data-testid=course-preview-stage] [role=alert]"]);
    });

    test("Atlas's search, map tools, attribution and route tray clear the insets", async ({ page }) => {
      await installDeterministicCesiumAtlas(page);
      await open(page, orientation, "/#/atlas");
      await expect(page.locator('div[data-atlas-engine="cesium"]')).toHaveAttribute("data-atlas-status", "ready");
      // The deterministic world has no Cesium credits: add them where Cesium
      // puts them, with the inline offset Cesium writes.
      await page.evaluate(() => {
        const credits = document.createElement("div");
        credits.className = "cesium-viewer-bottom atlas-attribution";
        credits.style.cssText = "position:absolute;left:5px;bottom:3px";
        credits.innerHTML = '<a href="https://cesium.com/">Cesium ion</a>';
        document.querySelector(".atlas-layout > div")!.append(credits);
      });
      const roots = [".atlas-discovery", "[role=group][aria-label='Map controls']", ".cesium-viewer-bottom", ".atlas-route-carousel"];
      await expectEdgeBarsClear(page, orientation, roots);
      await expectApart({
        search: page.getByRole("region", { name: "Atlas search" }),
        tools: page.getByRole("group", { name: "Map controls" }),
        credits: page.locator(".cesium-viewer-bottom"),
      });

      await page.getByRole("textbox", { name: "Search places and routes" }).fill("Kyoto");
      await page.getByRole("option", { name: "Kyoto, Japan", exact: true }).click();
      const tray = page.locator("section.atlas-route-carousel");
      await expect(tray.locator("article[data-route-slug]").first()).toBeVisible();
      await expectEdgeBarsClear(page, orientation, roots);
      await expectApart({ tools: page.getByRole("group", { name: "Map controls" }), tray, credits: page.locator(".cesium-viewer-bottom") });
    });

    test("Atlas's regional map keeps its attribution inside the safe area", async ({ page }) => {
      await page.addInitScript(() => { (window as typeof window & { __GODIESEL_ATLAS_REGION_OUTCOME__?: string }).__GODIESEL_ATLAS_REGION_OUTCOME__ = "fallback"; });
      await stubMapStyle(page);
      await installDeterministicCesiumAtlas(page);
      await open(page, orientation, "/#/atlas?region=Crete%2C+Greece");
      const fallback = page.locator('[data-atlas-engine="maplibre-regional-fallback"]');
      await expect(fallback).toHaveAttribute("data-map-status", "ready");
      await expect(fallback.locator(".maplibregl-ctrl-attrib")).toContainText("OpenStreetMap");
      await expectEdgeBarsClear(page, orientation, [".maplibregl-control-container", ".atlas-route-carousel"]);
      await expectApart({ attribution: fallback.locator(".maplibregl-ctrl-attrib"), tray: page.locator("section.atlas-route-carousel") });
    });

    test("the route guide's map overlays, panel and actions clear the insets", async ({ page }) => {
      await stubMapStyle(page);
      await open(page, orientation, "/#/routes/17654151284");
      const geography = page.getByRole("region", { name: "Route geography" });
      await expect(geography).toHaveAttribute("data-map-status", "ready");
      await expectEdgeBarsClear(page, orientation, ["[aria-label='Route margin']", "[aria-label='Route geography']"]);
      await expectApart({
        legend: geography.getByText("Start", { exact: true }).first(),
        tools: page.getByRole("button", { name: "Reset route map", exact: true }),
        attribution: geography.locator(".maplibregl-ctrl-attrib"),
      });
      if (orientation === PORTRAIT) {
        await page.getByRole("button", { name: "Expand route margin", exact: true }).click();
        await expect(page.getByRole("complementary", { name: "Route margin" })).toHaveAttribute("data-snap", "expanded");
        await expect.poll(async () => (await page.getByRole("complementary", { name: "Route margin" }).boundingBox())!.y).toBeGreaterThanOrEqual(orientation.insets.top);
        await expectEdgeBarsClear(page, orientation, ["[aria-label='Route margin']"]);
      }
    });

    test("the Routes filter panel's pinned button clears the insets", async ({ page }) => {
      await open(page, orientation, "/#/routes");
      const filters = page.getByRole("button", { name: "Filters", exact: true });
      if ((await filters.getAttribute("aria-expanded")) === "false") await filters.click();
      const show = page.getByRole("button", { name: /^Show \d+ routes?$/ });
      await expect(show).toBeVisible();
      // The button rides at the bottom while its panel scrolls: bring the
      // panel to the top so the pin, not the panel's start, decides its place.
      await page.locator("main div.sticky").evaluate((pin) => pin.parentElement!.scrollIntoView({ block: "start" }));
      await expectEdgeBarsClear(page, orientation, ["main div.sticky"]);
      if (orientation === PORTRAIT) {
        const navigation = await boxOf(page.getByTestId("atlas-spine-mobile"));
        const button = await boxOf(show);
        expect(button.y + button.height).toBeLessThanOrEqual(navigation.y);
      }
    });

    for (const [path, heading] of [
      ["/#/routes", "Places worth returning to."],
      ["/#/courses", "Create a course"],
      ["/#/nope", "There’s nothing at this address."],
      ["/#/admin", undefined],
    ] as const) {
      test(`the shell's content area clears the insets on ${path}`, async ({ page }) => {
        await open(page, orientation, path);
        if (heading) await expect(page.getByRole("heading", { name: heading })).toBeVisible();
        else await expect(page.getByTestId("app-header")).toBeVisible();
        // The page scrolls past the bottom edge; its top and sides do not move.
        await expectEdgeBarsClear(page, orientation, ["main"], { edges: ["top", "right", "left"], targets: false });
      });
    }

    test("the offline page inside the shell clears the insets", async ({ page, context }) => {
      await open(page, orientation, "/#/routes");
      await expect(page.getByRole("heading", { name: "Places worth returning to." })).toBeVisible();
      await context.setOffline(true);
      const navigation = page.getByTestId(orientation === PORTRAIT ? "atlas-spine-mobile" : "atlas-spine");
      await navigation.getByRole("link", { name: "Finder", exact: true }).click();
      await expect(page.getByRole("heading", { name: "You’re offline." })).toBeVisible();
      await expectEdgeBarsClear(page, orientation, ["[data-testid=view-offline]"]);
      await context.setOffline(false);
    });

    test("Finder's search header and results clear the insets", async ({ page }) => {
      await open(page, orientation, "/#/finder");
      await expect(page.getByRole("heading", { name: "Where would you like to go?" })).toBeVisible();
      await expectEdgeBarsClear(page, orientation, ["main > section"]);
    });

    test("the route intelligence lab's header clears the insets", async ({ page }) => {
      await open(page, orientation, "/#/lab/route-intelligence");
      await expect(page.getByRole("heading", { name: "Two worlds, one route language" })).toBeVisible();
      // The lab's field-test switch is 40 px tall today; this package only
      // moves it.
      await expectEdgeBarsClear(page, orientation, ["[data-testid=route-intelligence-lab] > header"], { targets: false });
    });
  });
}

test.describe("Earth and Atlas Replay", () => {
  // A phone: coarse pointer, so controls take their touch sizes.
  test.use({ hasTouch: true, isMobile: true });

  async function installEarthReplay(page: Page) {
    await page.addInitScript(() => {
      window.__GODIESEL_REPLAY_ENGINE_FACTORY__ = () => ({
        async mount(options) {
          const credit = document.createElement("a");
          credit.href = "https://cesium.com/";
          credit.textContent = "Provider attribution fixture";
          credit.style.cssText = "position:absolute;bottom:5px;left:5px;font-size:12px";
          options.container.append(credit);
          options.onStatus({ state: "ready", title: "Earth Replay ready", message: "Ready." });
        },
        setPose() {},
        destroy() {},
      });
    });
  }

  test("the route context and dock clear the insets in portrait", async ({ page }) => {
    await installEarthReplay(page);
    await open(page, PORTRAIT, "/#/replay/17654151284?renderer=cesium");
    await expect(page.getByTestId("replay-stage")).toHaveAttribute("data-state", "ready");
    await expectEdgeBarsClear(page, PORTRAIT, ["[data-testid=replay-stage] > .pointer-events-none.absolute", "[data-testid=replay-controls]"]);
    await expectApart({ context: page.getByTestId("replay-context"), dock: page.getByTestId("replay-controls") });
  });

  test("the route context and dock clear the insets in landscape", async ({ page }) => {
    await installEarthReplay(page);
    await open(page, LANDSCAPE, "/#/replay/17654151284?renderer=cesium");
    await expect(page.getByTestId("replay-stage")).toHaveAttribute("data-state", "ready");
    await expectEdgeBarsClear(page, LANDSCAPE, ["[data-testid=replay-stage] > .pointer-events-none.absolute", "[data-testid=replay-controls]"]);
    await expectApart({ context: page.getByTestId("replay-context"), dock: page.getByTestId("replay-controls") });
  });
});

/** Every dock control, the map's attribution and its compass lie inside the stage. */
async function expectDockAndMapInsideStage(page: Page, touch: boolean) {
  const stage = page.getByTestId("replay-stage");
  await expect(stage).toHaveAttribute("data-state", "ready");
  await expect(stage.locator(".maplibregl-ctrl-attrib")).toContainText("OpenStreetMap");
  const result = await stage.evaluate((root, touch) => {
    const bounds = root.getBoundingClientRect();
    const problems: string[] = [];
    const inside = (el: Element, name: string) => {
      const r = el.getBoundingClientRect();
      if (r.left < bounds.left - 0.5 || r.right > bounds.right + 0.5 || r.top < bounds.top - 0.5 || r.bottom > bounds.bottom + 0.5)
        problems.push(`${name} outside the stage [${[r.left, r.right].map(Math.round)}] vs [${[bounds.left, bounds.right].map(Math.round)}]`);
      return r;
    };
    for (const control of root.querySelectorAll("[data-testid=replay-controls] :is(button, a[href], [role=slider])")) {
      if (!control.checkVisibility()) continue;
      const name = control.getAttribute("aria-label") || control.textContent?.trim() || control.tagName;
      const r = inside(control, name);
      if (touch && !control.matches("input[type=range]") && (r.width < 43.5 || r.height < 43.5))
        problems.push(`${name} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    for (const selector of [".maplibregl-ctrl-attrib", ".maplibregl-ctrl-compass"]) {
      const el = root.querySelector(selector);
      if (!el) problems.push(`${selector} missing`);
      else inside(el, selector);
    }
    const dock = root.querySelector("[data-testid=replay-controls]")!;
    return { problems, dockOverflow: dock.scrollWidth - dock.clientWidth };
  }, touch);
  expect(result.problems).toEqual([]);
  expect(result.dockOverflow, "dock content wider than the dock").toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
}

// The desktop dock is one row; where its box is narrower than the row needs,
// the stage uses the compact dock. The map's column never outgrows the stage.
test.describe("Earth/Atlas Replay dock fits its stage on touch screens", () => {
  test.use({ hasTouch: true, isMobile: true });
  const none = { top: 0, right: 0, bottom: 0, left: 0 };
  for (const [name, viewport, insets] of [
    ["768x1024", { width: 768, height: 1024 }, none],
    ["844x390", { width: 844, height: 390 }, none],
    ["844x390 with simulated insets", { width: 844, height: 390 }, LANDSCAPE.insets],
    ["1024x768", { width: 1024, height: 768 }, none],
  ] as const) {
    test(`at ${name}`, async ({ page }) => {
      await stubMapStyle(page);
      await open(page, { name, viewport, insets }, "/#/replay/17654151284?renderer=atlas");
      await expectDockAndMapInsideStage(page, true);
      if (insets !== none)
        await expectEdgeBarsClear(page, LANDSCAPE, ["[data-testid=replay-controls]", "[data-testid=replay-stage] .maplibregl-control-container"]);
    });
  }
});

test("Earth/Atlas Replay dock fits its stage on a 1280 px desktop", async ({ page }) => {
  await stubMapStyle(page);
  await open(page, { name: "desktop", viewport: { width: 1280, height: 800 }, insets: { top: 0, right: 0, bottom: 0, left: 0 } }, "/#/replay/17654151284?renderer=atlas");
  await expectDockAndMapInsideStage(page, false);
  await expect(page.getByTestId("replay-controls")).toHaveAttribute("data-dock-form", "row");
});
