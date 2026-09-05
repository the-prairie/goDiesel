import { expect, test, type Page } from "@playwright/test";

// These adapters prove controls and navigation only. They are not imagery or shader proof.
async function installAdapters(page: Page, worldState: "ready" | "partial" | "unavailable" = "ready") {
  await page.addInitScript((state) => {
    const target = window as typeof window & {
      __worldCalls: Array<{ event: string; value?: unknown }>;
      __GODIESEL_CINEMATIC_WORLD_FACTORY__?: () => unknown;
      __GODIESEL_GOOGLE_ROUTE_NAVIGATOR_FACTORY__?: () => unknown;
    };
    target.__worldCalls = [];
    const factory = (mode: string) => () => ({
      async mount({ container, onStatus }: { container: HTMLElement; onStatus: (value: { state: string; message: string }) => void }) {
        target.__worldCalls.push({ event: `${mode}:mount` });
        const surface = document.createElement("div");
        surface.style.cssText = "width:100%;height:100%;background:#314c52";
        surface.dataset.testid = "world-control-test-adapter";
        surface.textContent = "Control test adapter — not provider imagery";
        container.replaceChildren(surface);
        onStatus({ state: mode === "cinematic" ? state : "ready", message: state === "partial" ? "Atmosphere unavailable; terrain remains usable." : "Control test adapter" });
      },
      setEnvironment(value: unknown) { target.__worldCalls.push({ event: "environment", value }); },
      setCamera(value: unknown) { target.__worldCalls.push({ event: `${mode}:camera`, value }); },
      setCinematicRoute() {}, setRouteReveal() {}, setFollowing() {}, setGrounding() {},
      destroy() { target.__worldCalls.push({ event: `${mode}:destroy` }); },
    });
    target.__GODIESEL_CINEMATIC_WORLD_FACTORY__ = factory("cinematic");
    target.__GODIESEL_GOOGLE_ROUTE_NAVIGATOR_FACTORY__ = factory("native");
  }, worldState);
}

test("native remains the default and does not download the cinematic runtime", async ({ page }) => {
  await installAdapters(page);
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("/#/replay/14130782031");
  await expect(page.getByTestId("replay-stage")).toHaveAttribute("data-state", "ready");
  await expect(page.getByTestId("replay-stage")).toHaveAttribute("data-engine", "google-3d-maps");
  expect(requests.filter((url) => /cinematic-world-engine-/.test(url))).toEqual([]);
});

test("switches worlds at the same distance, applies real controls without remounting, and returns to the story", async ({ page }) => {
  await installAdapters(page);
  await page.goto("/#/replay/14130782031");
  await page.getByRole("navigation", { name: "Replay chapters" }).getByRole("button", { name: /high point/i }).click();
  const progress = page.getByTestId("google-route-progress");
  const before = await progress.textContent();
  await page.getByRole("button", { name: "Replay settings", exact: true }).click();
  await page.getByRole("button", { name: "Cinematic world", exact: true }).click();
  await expect(page).toHaveURL(/renderer=cinematic/);
  await expect(page.getByTestId("replay-stage")).toHaveAttribute("data-engine", "cinematic-world");
  await expect(progress).toHaveText(before!);
  await page.getByRole("button", { name: "Golden hour", exact: true }).click();
  await page.getByRole("slider", { name: "Cloud cover", exact: true }).fill("65");
  await page.getByRole("checkbox", { name: "Road names and landmarks" }).uncheck();
  await expect.poll(() => page.evaluate(() => {
    const calls = (window as unknown as { __worldCalls: Array<{ event: string; value?: unknown }> }).__worldCalls;
    return calls.filter((call) => call.event === "environment").at(-1)?.value;
  })).toMatchObject({ light: "golden", clouds: 0.65, labels: false });
  expect(await page.evaluate(() => (window as unknown as { __worldCalls: Array<{ event: string }> }).__worldCalls.filter((call) => call.event === "cinematic:mount").length)).toBe(1);
  await page.getByRole("button", { name: "Native Replay", exact: true }).click();
  await expect(page.getByTestId("replay-stage")).toHaveAttribute("data-engine", "google-3d-maps");
  await expect(progress).toHaveText(before!);
  await page.getByRole("button", { name: "Route story", exact: true }).click();
  await expect(page).toHaveURL(/#\/routes\/14130782031/);
});

test("an optional atmosphere failure does not cover or disable playback", async ({ page }) => {
  await installAdapters(page, "partial");
  await page.goto("/#/replay/14130782031?renderer=cinematic");
  await expect(page.getByTestId("replay-partial-status")).toContainText("Atmosphere unavailable");
  await page.getByRole("button", { name: "Play route", exact: true }).click();
  await expect.poll(async () => Number((await page.getByTestId("google-route-progress").textContent())?.split(" ")[0])).toBeGreaterThan(0);
});

test("terrain failure offers a working native recovery", async ({ page }) => {
  await installAdapters(page, "unavailable");
  await page.goto("/#/replay/14130782031?renderer=cinematic");
  await page.getByRole("button", { name: "Use Native Replay", exact: true }).click();
  await expect(page.getByTestId("replay-stage")).toHaveAttribute("data-state", "ready");
  await expect(page.getByTestId("replay-stage")).toHaveAttribute("data-engine", "google-3d-maps");
});

test("the real engine reports a missing key rather than displaying fixture success", async ({ page }) => {
  const terrainRequests: string[] = [];
  page.on("request", (request) => { if (request.url().includes("tile.googleapis.com")) terrainRequests.push(request.url()); });
  await page.goto("/#/replay/14130782031?renderer=cinematic");
  await expect(page.getByRole("alert")).toContainText("Map Tiles API");
  await expect(page.getByTestId("cinematic-world-canvas")).toHaveCount(0);
  expect(terrainRequests).toEqual([]);
});

for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }]) {
  test(`world settings fit ${viewport.width}px and honor reduced motion`, async ({ page }, testInfo) => {
    await installAdapters(page);
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/#/replay/14130782031?renderer=cinematic");
    await page.getByRole("button", { name: "Replay settings", exact: true }).click();
    const panel = page.getByRole("complementary", { name: "Replay settings panel" });
    const rect = await panel.boundingBox();
    expect(rect!.x).toBeGreaterThanOrEqual(0);
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(viewport.width);
    await page.getByRole("button", { name: "Light", exact: true }).click();
    await expect(page.getByRole("slider", { name: "Cloud cover", exact: true })).toBeDisabled();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __worldCalls: Array<{ event: string; value?: unknown }> }).__worldCalls.filter((call) => call.event === "environment").at(-1)?.value)).toMatchObject({ reducedMotion: true, quality: "light" });
    await page.screenshot({ path: testInfo.outputPath(`world-settings-${viewport.width}.png`) });
  });
}
