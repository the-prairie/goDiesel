import { expect, test, type Page } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";

const clean = (value: string) => value
  .replace(/https?:\/\/[^\s)"']+/g, (text) => {
    try { const url = new URL(text); return url.origin + url.pathname; }
    catch { return "[provider URL]"; }
  })
  .replace(/AIza[\w-]+/g, "[redacted]");

async function revealReplayControls(page: Page) {
  const viewport = page.viewportSize()!;
  // Immersive playback intentionally hides/inerts its controls after 1.8s.
  // A real pointer move reveals them; never force-click an inaccessible control.
  await page.mouse.move(viewport.width / 2, viewport.height / 2, { steps: 2 });
  await expect(page.getByTestId("replay-stage")).toHaveAttribute("data-hud-state", "expanded");
}

async function rendererEvidence(page: Page) {
  return page.evaluate(() => {
    const stage = document.querySelector<HTMLElement>('[data-testid="replay-stage"]');
    const world = document.querySelector<HTMLElement>("[data-world-terrain]");
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="cinematic-world-canvas"]');
    const gl = canvas?.getContext("webgl2");
    const debug = gl?.getExtension("WEBGL_debug_renderer_info");
    const detail: { report: unknown } = { report: null };
    world?.dispatchEvent(new CustomEvent("godiesel:world-diagnostics", { detail }));
    return {
      viewport: { width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio },
      stage: stage ? { ...stage.dataset } : null,
      world: world ? { ...world.dataset } : null,
      report: detail.report,
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
    // Bound missing controls separately so failure evidence survives.
    page.setDefaultTimeout(15_000);
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

      // Exercise normal keyboard activation on the live world; no forced clicks.
      await page.getByRole("button", { name: "Chase", exact: true }).press("Enter");
      await expect(page.getByTestId("replay-stage")).toHaveAttribute("data-camera-mode", "chase");
      // Preserve a failing label verdict, but still collect playback and lighting evidence.
      await expect.configure({ soft: true }).poll(async () => Number(await world.getAttribute("data-world-label-count")), { timeout: 45_000 }).toBeGreaterThan(0);
      await page.waitForTimeout(1500);
      evidence.snapshots.push(await rendererEvidence(page));
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
      evidence.snapshots.push(await rendererEvidence(page));
      await revealReplayControls(page);
      await page.getByRole("button", { name: "Pause route", exact: true }).press("Enter");
      await expect(page.getByRole("button", { name: "Play route", exact: true })).toBeVisible();
      evidence.snapshots.push(await rendererEvidence(page));
      await page.screenshot({ path: testInfo.outputPath("03-live-playback.png") });

      await page.getByRole("button", { name: "Replay settings", exact: true }).click();
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: "Save playback report", exact: true }).click();
      const download = await downloadPromise;
      const reportPath = testInfo.outputPath("device-playback-report.json");
      await download.saveAs(reportPath);
      const report = JSON.parse(readFileSync(reportPath, "utf8"));
      expect(report.schema).toBe("godiesel-world-report-v1");
      expect(report.routeSlug).toBe(journey.slug);
      expect(report.frames.samples).toBeGreaterThan(0);
      expect(report.terrain.renderedMeshes).toBeGreaterThan(0);
      expect(readFileSync(reportPath, "utf8")).not.toMatch(/AIza|[?&](?:key|token|session)=/);
      // Explicit Cinema keeps cloud rendering enabled even on a slow CI GPU.
      await page.getByRole("button", { name: "Cinema", exact: true }).click();
      await page.getByRole("button", { name: "Golden hour", exact: true }).click();
      await page.getByRole("slider", { name: "Cloud cover", exact: true }).fill("55");
      await page.getByRole("button", { name: "Replay settings", exact: true }).click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: testInfo.outputPath("04-live-golden-clouds.png") });
      evidence.snapshots.push(await rendererEvidence(page));
      await expect(world).toHaveAttribute("data-effective-quality", "cinema");
      await expect(world).toHaveAttribute("data-world-atmosphere", "ready");
      expect(evidence.errors).toEqual([]);
      expect(evidence.failures).toEqual([]);
      await expect(world).toHaveAttribute("data-world-terrain", "ready");
    } finally {
      // Always retain useful, redacted evidence on failure. No trace/HAR, tile
      // response bodies, browser bundle, request headers or API-key URLs are uploaded.
      if (!page.isClosed()) {
        evidence.snapshots.push(await rendererEvidence(page).catch(() => ({ viewport: { width: 0, height: 0, pixelRatio: 0 }, stage: null, world: null, report: null, graphics: null })));
        await page.screenshot({ path: testInfo.outputPath("05-live-final-state.png") }).catch(() => {});
      }
      // A text-only reporter does not persist in-memory attachment bodies.
      const report = testInfo.outputPath("live-evidence.json");
      writeFileSync(report, JSON.stringify(evidence, null, 2));
      await testInfo.attach("live-provider-and-renderer-evidence", { path: report, contentType: "application/json" });
    }
  });
}
