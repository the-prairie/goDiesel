import { expect, test, type Page } from "@playwright/test";

const clean = (value: string) => value
  .replace(/https?:\/\/[^\s)"']+/g, (text) => {
    try { const url = new URL(text); return url.origin + url.pathname; }
    catch { return "[provider URL]"; }
  })
  .replace(/AIza[\w-]+/g, "[redacted]");

async function rendererEvidence(page: Page) {
  return page.evaluate(() => {
    const stage = document.querySelector<HTMLElement>('[data-testid="replay-stage"]');
    const world = document.querySelector<HTMLElement>("[data-world-terrain]");
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="cinematic-world-canvas"]');
    const gl = canvas?.getContext("webgl2");
    const debug = gl?.getExtension("WEBGL_debug_renderer_info");
    return {
      viewport: { width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio },
      stage: stage ? { ...stage.dataset } : null,
      world: world ? { ...world.dataset } : null,
      graphics: gl ? {
        renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        contextLost: gl.isContextLost(),
      } : null,
    };
  });
}

// Real published routes, real provider responses. A phone-sized desktop browser is
// a layout check, not a claim about the owner's phone or hardware performance.
for (const journey of [
  { slug: "14130782031", label: "Crete relief", width: 1280, height: 720 },
  { slug: "17665674778", label: "Tokyo streets", width: 1280, height: 720 },
]) {
  test(`live Google world: ${journey.label}`, async ({ page, browser }, testInfo) => {
    const evidence = {
      sourceCommit: process.env.GODIESEL_WORLD_SOURCE_SHA ?? "unrecorded",
      origin: new URL(testInfo.project.use.baseURL as string).origin,
      slug: journey.slug,
      browser: browser.version(),
      synthetic: false,
      googleResponses: 0,
      googleModelResponses: 0,
      vectorResponses: 0,
      failures: [] as { host: string; status: number }[],
      errors: [] as string[],
      snapshots: [] as Awaited<ReturnType<typeof rendererEvidence>>[],
      timing: null as { frames: number; medianMs: number; p95Ms: number; above50Ms: number } | null,
    };
    await page.setViewportSize({ width: journey.width, height: journey.height });
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (url.hostname === "tile.googleapis.com") {
        if (response.ok()) {
          evidence.googleResponses++;
          if (url.pathname.endsWith(".glb")) evidence.googleModelResponses++;
        } else evidence.failures.push({ host: url.hostname, status: response.status() });
      }
      if (response.ok() && /\.(pbf|pmtiles)$/.test(url.pathname)) evidence.vectorResponses++;
    });
    page.on("pageerror", (error) => evidence.errors.push(clean(error.message)));
    try {
      await page.goto(`/#/replay/${journey.slug}?renderer=cinematic`);
      expect(await page.evaluate(() => Object.keys(window).some((name) => /^__GODIESEL_.*FACTORY__$/.test(name) && Boolean((window as unknown as Record<string, unknown>)[name])))).toBe(false);
      const world = page.locator("[data-world-terrain]");
      await expect(world).toHaveAttribute("data-world-terrain", "ready", { timeout: 60_000 });
      await expect(world).toHaveAttribute("data-world-atmosphere", "ready", { timeout: 45_000 });
      await expect.poll(async () => Number(await world.getAttribute("data-rendered-tile-meshes")), { timeout: 15_000 }).toBeGreaterThan(0);
      evidence.snapshots.push(await rendererEvidence(page));
      await page.screenshot({ path: testInfo.outputPath("01-live-overview.png") });

      await page.getByRole("button", { name: "Chase", exact: true }).click();
      await expect.poll(async () => Number(await world.getAttribute("data-world-label-count")), { timeout: 45_000 }).toBeGreaterThan(0);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: testInfo.outputPath("02-live-road-alignment.png") });
      expect(evidence.googleResponses).toBeGreaterThan(1);
      expect(evidence.googleModelResponses).toBeGreaterThan(0);
      expect(evidence.vectorResponses).toBeGreaterThan(0);

      await page.getByRole("button", { name: "Play route", exact: true }).click();
      await expect.poll(async () => Number((await page.getByTestId("google-route-progress").textContent())?.split(" ")[0]), { timeout: 15_000 }).toBeGreaterThan(0.05);
      evidence.timing = await page.evaluate(() => new Promise((resolve) => {
        const values: number[] = [];
        let previous = performance.now();
        const end = previous + 8000;
        const tick = (now: number) => {
          values.push(now - previous); previous = now;
          if (now < end) { requestAnimationFrame(tick); return; }
          values.sort((a, b) => a - b);
          resolve({ frames: values.length, medianMs: values[Math.floor(values.length / 2)], p95Ms: values[Math.min(values.length - 1, Math.floor(values.length * 0.95))], above50Ms: values.filter((value) => value > 50).length });
        };
        requestAnimationFrame(tick);
      }));
      await page.getByRole("button", { name: "Pause route", exact: true }).click();
      evidence.snapshots.push(await rendererEvidence(page));
      await page.screenshot({ path: testInfo.outputPath("03-live-playback.png") });

      await page.getByRole("button", { name: "Replay settings", exact: true }).click();
      await page.getByRole("button", { name: "Golden hour", exact: true }).click();
      await page.getByRole("slider", { name: "Cloud cover", exact: true }).fill("55");
      await page.getByRole("button", { name: "Replay settings", exact: true }).click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: testInfo.outputPath("04-live-golden-clouds.png") });
      expect(evidence.errors).toEqual([]);
      expect(evidence.failures).toEqual([]);
      await expect(world).toHaveAttribute("data-world-terrain", "ready");
    } finally {
      // Always retain useful, redacted evidence on failure. No trace/HAR, tile
      // response bodies, browser bundle, request headers or API-key URLs are uploaded.
      if (!page.isClosed()) {
        evidence.snapshots.push(await rendererEvidence(page).catch(() => ({ viewport: { width: 0, height: 0, pixelRatio: 0 }, stage: null, world: null, graphics: null })));
        await page.screenshot({ path: testInfo.outputPath("05-live-final-state.png") }).catch(() => {});
      }
      await testInfo.attach("live-provider-and-renderer-evidence", { body: JSON.stringify(evidence, null, 2), contentType: "application/json" });
    }
  });
}
