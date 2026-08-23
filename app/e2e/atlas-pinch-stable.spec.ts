import { expect, test } from "@playwright/test";

// The production Atlas currently reports its outer ready state before the
// initial 600 ms Cesium camera flight is guaranteed to have settled. Issue #111
// tracks making that lifecycle state authoritative. This focused regression
// waits for the actual global destination so it tests two-finger navigation,
// not a race between the gesture and startup motion.
test("mobile globe pinches after the global camera settles", async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:8791",
    hasTouch: true,
    isMobile: true,
    viewport: { width: 430, height: 844 },
  });
  const page = await context.newPage();

  try {
    await page.goto("/#/atlas");
    const canvas = page.getByLabel("Interactive route globe");
    await expect(page.locator('div[data-atlas-engine="cesium"]')).toHaveAttribute(
      "data-atlas-status",
      "ready",
    );
    await expect
      .poll(async () => Number(await canvas.getAttribute("data-camera-target")))
      .toBeGreaterThan(18_000_000);

    const before = Number(await canvas.getAttribute("data-camera-target"));
    const box = (await canvas.boundingBox())!;
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    const client = await context.newCDPSession(page);

    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { x: centerX - 45, y: centerY, id: 11 },
        { x: centerX + 45, y: centerY, id: 12 },
      ],
    });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: centerX - 100, y: centerY, id: 11 },
        { x: centerX + 100, y: centerY, id: 12 },
      ],
    });
    await page.waitForTimeout(50);
    await client.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });

    await expect
      .poll(async () => Number(await canvas.getAttribute("data-camera-target")))
      .toBeLessThan(before);
    await page.getByRole("combobox", { name: "Browse route regions" }).selectOption({
      label: "Kyoto, Japan",
    });
    await expect(page).toHaveURL(/region=Kyoto%2C\+Japan/);
  } finally {
    await context.close();
  }
});
