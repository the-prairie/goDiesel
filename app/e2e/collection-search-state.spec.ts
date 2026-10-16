import { expect, test, type Page } from "@playwright/test";

declare global {
  interface Window {
    __searchWorkers: Array<{ onmessage?: (event: { data: { vector?: number[]; error?: boolean } }) => void; onerror?: () => void; terminated: boolean }>;
  }
}

async function fakeEmbeddings(page: Page, throws = false) {
  await page.addInitScript(({ throws }) => {
    const NativeWorker = window.Worker;
    window.__searchWorkers = [];
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        if (!String(url).includes("embedding.worker")) return new NativeWorker(url, options);
        if (throws) throw new Error("Fixture worker construction failed");
        const worker = {
          terminated: false,
          onmessage: undefined,
          onerror: undefined,
          postMessage() {},
          terminate() { this.terminated = true; },
        };
        window.__searchWorkers.push(worker);
        return worker as unknown as Worker;
      }
    };
  }, { throws });
}

const limited = "Search is limited to available route details right now.";
const searchUrl = "/#/finder?place=Kyoto&activity=Run&distance=21&vibe=Kyoto";

test("collection index failure keeps basic route results", async ({ page }) => {
  await page.route("**/search/collection.json", route => route.fulfill({ status: 503, body: "unavailable" }));
  await page.goto(searchUrl);
  await expect(page.getByText(limited, { exact: true })).toBeVisible();
  await expect(page.getByRole("article", { name: "Kyoto, Japan candidate" })).toBeVisible();
});

for (const outcome of ["success", "error", "worker-error", "timeout", "construction"] as const) {
  test(`collection semantic ${outcome} preserves usable results`, async ({ page }) => {
    await fakeEmbeddings(page, outcome === "construction");
    if (outcome === "timeout") await page.clock.install();
    await page.goto(searchUrl);
    if (outcome !== "construction") {
      await expect.poll(() => page.evaluate(() => window.__searchWorkers.length)).toBe(1);
      await expect(page.getByRole("article", { name: "Kyoto, Japan candidate" })).toBeVisible();
      if (outcome === "timeout") {
        await page.clock.fastForward(60_001);
      } else if (outcome === "worker-error") {
        await page.evaluate(() => window.__searchWorkers[0].onerror?.());
      } else {
        await page.evaluate((outcome) => {
          window.__searchWorkers[0].onmessage?.({ data: outcome === "success" ? { vector: [] } : { error: true } });
        }, outcome);
      }
      await expect.poll(() => page.evaluate(() => window.__searchWorkers[0].terminated)).toBe(true);
    }
    await expect(page.getByText(limited, { exact: true })).toHaveCount(outcome === "success" ? 0 : 1);
    await expect(page.getByRole("article", { name: "Kyoto, Japan candidate" })).toBeVisible();
  });
}

test("collection replacement and scope cleanup reject old worker outcomes", async ({ page }) => {
  await fakeEmbeddings(page);
  await page.goto(searchUrl);
  await expect.poll(() => page.evaluate(() => window.__searchWorkers.length)).toBe(1);
  await page.getByRole("button", { name: "Discover new routes", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__searchWorkers[0].terminated)).toBe(true);
  await page.getByRole("button", { name: "My collection · 67", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__searchWorkers.length)).toBe(2);
  await page.evaluate(() => window.__searchWorkers[0].onmessage?.({ data: { error: true } }));
  await expect(page.getByText(limited, { exact: true })).toHaveCount(0);
  await page.evaluate(() => window.__searchWorkers[1].onmessage?.({ data: { vector: [] } }));
  await expect(page.getByRole("article", { name: "Kyoto, Japan candidate" })).toBeVisible();
});

test("empty themes bypass semantic inference", async ({ page }) => {
  await fakeEmbeddings(page);
  await page.goto("/#/finder?place=Kyoto&activity=Run&distance=21");
  await expect(page.getByRole("article", { name: "Kyoto, Japan candidate" })).toBeVisible();
  expect(await page.evaluate(() => window.__searchWorkers.length)).toBe(0);
});

test("named-route similarity uses indexed vectors without starting inference", async ({ page }) => {
  await fakeEmbeddings(page);
  await page.goto("/#/finder?activity=Run&distance=21&like=Kyoto");
  await expect(page.getByRole("article").first()).toBeVisible();
  expect(await page.evaluate(() => window.__searchWorkers.length)).toBe(0);
});

test("single mobile collection result uses a singular count", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fakeEmbeddings(page);
  await page.goto("/#/finder?activity=Run&distance=0&q=Westminster%20Kensington%20Gardens");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByLabel("Results view")).toContainText("1 route");
  await expect(page.getByLabel("Results view")).not.toContainText("1 routes", { timeout: 2000 });
});
