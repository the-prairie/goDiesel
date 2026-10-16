import { expect, test, type Page } from "@playwright/test";

declare global {
  interface Window {
    __rankingWorkers: Array<{ onmessage?: (event: { data: { vectors?: number[][]; error?: boolean } }) => void; onerror?: () => void; terminated: boolean }>;
  }
}

async function rankingFixture(page: Page, throws = false) {
  await page.addInitScript(({ throws }) => {
    const NativeWorker = window.Worker;
    window.__rankingWorkers = [];
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        if (!String(url).includes("embedding.worker")) return new NativeWorker(url, options);
        if (throws) throw new Error("Fixture ranking worker unavailable");
        const worker = { terminated: false, onmessage: undefined, onerror: undefined,
          postMessage() {}, terminate() { this.terminated = true; } };
        window.__rankingWorkers.push(worker);
        return worker as unknown as Worker;
      }
    };
  }, { throws });
  await page.route("**/api/discovery?**", route => route.fulfill({ json: { routes: [
    { id: "coast", name: "Coastal path", description: "Along the sea.", sourceUrl: "https://www.openstreetmap.org/relation/123", activity: "Run", distanceKm: 4, distanceKind: "mapped", lines: [[[135.7,35],[135.71,35.01]]] },
    { id: "forest", name: "Forest loop", description: "Trees and shade.", sourceUrl: "https://www.openstreetmap.org/relation/124", activity: "Run", distanceKm: 6, distanceKind: "mapped", lines: [[[135.72,35],[135.73,35.01]]] },
  ] } }));
}
const start = async (page: Page, query = "quiet coastal") => {
  await page.goto(`/#/finder?place=Kyoto&activity=Run&distance=0&scope=new&q=${encodeURIComponent(query)}`);
  await page.getByRole("button", { name: "Search new routes", exact: true }).click();
};
const notice = "Related matches may be limited right now.";

for (const outcome of ["success", "error", "timeout"] as const) {
  test(`external ranking ${outcome} retains usable lexical results`, async ({ page }) => {
    await rankingFixture(page);
    if (outcome === "timeout") await page.clock.install();
    await start(page);
    await expect(page.getByRole("article").first()).toHaveAccessibleName("Coastal path");
    await expect.poll(() => page.evaluate(() => window.__rankingWorkers.length)).toBe(1);
    if (outcome === "timeout") await page.clock.fastForward(90_001);
    else await page.evaluate(outcome => window.__rankingWorkers[0].onmessage?.({ data: outcome === "success" ? { vectors: [[1],[0],[1]] } : { error: true } }), outcome);
    await expect.poll(() => page.evaluate(() => window.__rankingWorkers[0].terminated)).toBe(true);
    await expect(page.getByRole("article").first()).toHaveAccessibleName(outcome === "success" ? "Forest loop" : "Coastal path");
    await expect(page.getByText(notice, { exact: true })).toHaveCount(outcome === "success" ? 0 : 1);
  });
}

test("empty external preference does not start inference", async ({ page }) => {
  await rankingFixture(page);
  await start(page, "");
  await expect(page.getByRole("article").first()).toHaveAccessibleName("Coastal path");
  expect(await page.evaluate(() => window.__rankingWorkers.length)).toBe(0);
});

test("external worker construction failure preserves ranked results", async ({ page }) => {
  await rankingFixture(page, true);
  await start(page);
  await expect(page.getByRole("article").first()).toHaveAccessibleName("Coastal path");
  await expect(page.getByText(notice, { exact: true })).toBeVisible();
});
