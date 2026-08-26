import { expect, test, type Locator } from "@playwright/test";
import { PNG } from "pngjs";

test.setTimeout(120_000);

const localOrigin = "http://127.0.0.1:8791";
const referenceRoutes = [
  { slug: "17665674778", worldId: "tokyo-urban" },
  { slug: "15573295095", worldId: "banff-mountain" },
  { slug: "6496900063", worldId: "ucluelet-coastal" },
] as const;

async function expectNonblankWorld(canvas: Locator) {
  const screenshot = PNG.sync.read(await canvas.screenshot());
  const colors = new Set<string>();
  let routePixels = 0;
  for (let index = 0; index < screenshot.data.length; index += 4) {
    const red = screenshot.data[index];
    const green = screenshot.data[index + 1];
    const blue = screenshot.data[index + 2];
    if (index % 256 === 0) colors.add(`${red},${green},${blue}`);
    if (blue > 120 && blue - red > 35) routePixels += 1;
  }
  expect(colors.size).toBeGreaterThan(12);
  expect(routePixels).toBeGreaterThan(8);
}

test("all reference worlds open from verified local media with providers blocked", async ({
  page,
}) => {
  const externalRequests: string[] = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === localOrigin) {
      await route.continue();
      return;
    }
    externalRequests.push(url.href);
    await route.abort("blockedbyclient");
  });

  for (const reference of referenceRoutes) {
    await page.goto(`/#/lab/playable-earth/${reference.slug}`);
    const lab = page.getByRole("region", { name: "Playable Earth Lab" });
    await expect(lab).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
    const canvas = page.locator('canvas[aria-label="Verified local World Pack"]');
    await expect(canvas).toHaveCount(1);
    await expect(canvas).toHaveAttribute("data-world-id", reference.worldId);
    await expect(canvas).toHaveAttribute("data-world-pack-state", "ready");
    await expect(canvas).toHaveAttribute("data-network-required", "false");
    await expect(canvas).toHaveAttribute(
      "data-physical-neighbourhood",
      "verified",
    );
    await expectNonblankWorld(canvas);
  }

  expect(externalRequests).toEqual([]);
});
