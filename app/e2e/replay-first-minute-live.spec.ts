import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { parseRouteDetail } from '../src/domain/route';
import { googleRouteCameraPose, initialGoogleRouteNavigatorState } from '../src/surfaces/replay/playback/route-navigator-controller';

import { sustainedRouteCamera } from '../src/surfaces/replay/scene/route-camera-score';

test.skip(process.env.GODIESEL_LIVE_GOOGLE_3D_E2E !== '1', 'Requires live Google imagery.');

test('a manual map drag releases camera follow without pausing playback', async ({ page }) => {
  await page.goto('/#/replay/14736711660');
  const stage = page.getByTestId('replay-stage');
  await expect(stage).toHaveAttribute('data-state', 'ready', { timeout: 40_000 });
  await page.getByRole('button', { name: 'Play route', exact: true }).click();
  const progress = page.getByLabel('Route progress', { exact: true });
  await expect.poll(async () => Number(await progress.inputValue())).toBeGreaterThan(5);
  const before = Number(await progress.inputValue());
  await page.mouse.move(550, 300);
  await page.mouse.down();
  await page.mouse.move(750, 350, { steps: 20 });
  await page.mouse.up();
  await expect(stage).toHaveAttribute('data-following', 'false');
  await expect.poll(async () => Number(await progress.inputValue())).toBeGreaterThan(before);
});

for (const width of [1440, 390]) {
  for (const slug of ['14736711660', '9953403673', '14023448720']) {
    test(`entry and controls ${slug} at ${width}`, async ({ page }) => {
      test.setTimeout(100_000);
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`/#/replay/${slug}`);
      const stage = page.getByTestId('replay-stage');
      await expect(stage).toHaveAttribute('data-state', 'ready', { timeout: 40_000 });
      await expect(stage).toHaveAttribute('data-directed-camera', 'chase');
      const map = page.locator('gmp-map-3d');
      expect(await map.evaluate(element => (element as google.maps.maps3d.Map3DElement).range)).toBeLessThanOrEqual(780);
      const position = page.getByTestId("replay-position-marker");
      await expect(position).toBeVisible();
      const bounds = await position.boundingBox();
      expect(bounds!.width).toBeGreaterThanOrEqual(8);
      expect(bounds!.x).toBeGreaterThan(0);
      expect(bounds!.x + bounds!.width).toBeLessThan(width);
      expect(bounds!.y).toBeGreaterThan(90);
      expect(bounds!.y + bounds!.height).toBeLessThan(width === 390 ? 620 : 780);
      const progress = page.getByLabel('Route progress', { exact: true });
      await expect(progress).toHaveValue('0');
      await page.getByRole('button', { name: 'Play route', exact: true }).click();
      await expect.poll(async () => Number(await progress.inputValue())).toBeGreaterThan(5);
      await page.getByRole('button', { name: 'Pause route', exact: true }).click();
      const paused = await progress.inputValue();
      await page.waitForTimeout(300);
      await expect(progress).toHaveValue(paused);
      await page.getByRole('button', { name: 'Playback speed 1x', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Playback speed 2x', exact: true })).toBeVisible();
      await progress.fill('1000');
      await expect(progress).toHaveValue('1000');
      await page.getByRole('button', { name: 'Replay settings', exact: true }).click();
      const settings = page.getByRole('dialog', { name: 'Replay settings' });
      for (const [name, mode] of [['Runner','runner'], ['Chase','chase'], ['Overview','overview'], ['Auto director','auto']]) {
        await settings.getByRole('button', { name, exact: true }).click();
        await expect(stage).toHaveAttribute('data-camera-mode', mode);
      }
      await page.getByRole('button', { name: 'Explore freely', exact: true }).click();
      await expect(stage).toHaveAttribute('data-following', 'false');
      await page.getByRole('button', { name: 'Follow route', exact: true }).click();
      await expect(stage).toHaveAttribute('data-following', 'true');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: 'Replay settings' })).not.toBeVisible();
      await page.waitForTimeout(2500);
      await page.screenshot({ path: `artifacts/replay-first-minute/controls-${slug}-${width}.png` });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      expect(errors).toEqual([]);
    });
  }
}

test('reduced motion opens at the route and route replacement resets progress', async ({ page }) => {
  test.setTimeout(100_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/#/replay/14736711660');
  const stage = page.getByTestId('replay-stage');
  await expect(stage).toHaveAttribute('data-state', 'ready', { timeout: 40_000 });
  await expect(stage).toHaveAttribute('data-directed-camera','chase');
  const before = await page.locator('gmp-map-3d').evaluate(element => {
    const map = element as google.maps.maps3d.Map3DElement;
    return { range: map.range, heading: map.heading, tilt: map.tilt };
  });
  await page.waitForTimeout(2500);
  expect(await page.locator('gmp-map-3d').evaluate(element => {
    const map = element as google.maps.maps3d.Map3DElement;
    return { range: map.range, heading: map.heading, tilt: map.tilt };
  })).toEqual(before);
  await page.getByLabel('Route progress',{ exact:true }).fill('2000');
  await page.getByRole('button', { name:'Change route', exact:true }).click();
  await page.getByPlaceholder('Search place or activity').fill('dogs');
  await page.getByRole('link', { name:/who let the dogs out/ }).click();
  await expect(stage).toHaveAttribute('data-route-slug','9953403673');
  await expect(stage).toHaveAttribute('data-state','ready',{timeout:40_000});
  await expect(page.getByLabel('Route progress',{exact:true})).toHaveValue('0');
});

for (const width of [1440, 390]) {
  test(`camera settles after moving pause and a seek at ${width}`, async ({ page }) => {
    test.setTimeout(80_000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const route = parseRouteDetail(JSON.parse(readFileSync("public/data/routes/14736711660.json", "utf8")));
    await page.goto("/#/replay/14736711660");
    await expect(page.getByTestId("replay-stage")).toHaveAttribute("data-state", "ready", { timeout: 40_000 });
    await page.getByRole("button", { name: "Play route", exact: true }).click();
    const progress = page.getByLabel("Route progress", { exact: true });
    await expect.poll(async () => Number(await progress.inputValue()), { timeout: 10_000 }).toBeGreaterThan(160);
    await page.getByRole("button", { name: "Pause route", exact: true }).click();
    for (const sought of [undefined, 1000]) {
      if (sought !== undefined) await progress.fill(String(sought));
      const state = { ...initialGoogleRouteNavigatorState(), progressM: Number(await progress.inputValue()) };
      const desired = sustainedRouteCamera(route, state, googleRouteCameraPose(route, state), width);
      await expect.poll(async () => page.locator("gmp-map-3d").evaluate((element, target) => {
        const map = element as google.maps.maps3d.Map3DElement;
        return Math.abs(map.range - target.rangeM) < 1.5 &&
          Math.abs(((map.heading - target.headingDeg + 540) % 360) - 180) < .5 &&
          Math.abs(map.tilt - target.tiltDeg) < .5;
      }, desired), { timeout: 12_000 }).toBe(true);
      await page.waitForTimeout(2500);
      const readPose = () => page.locator("gmp-map-3d").evaluate(element => {
        const map = element as google.maps.maps3d.Map3DElement;
        return { range: map.range, heading: map.heading, tilt: map.tilt };
      });
      const settled = await readPose();
      await page.waitForTimeout(750);
      const held = await readPose();
      expect(Math.abs(held.heading - settled.heading)).toBeLessThan(.1);
      expect(Math.abs(held.range - settled.range)).toBeLessThan(.5);
      expect(Math.abs(held.tilt - settled.tilt)).toBeLessThan(.1);
    }
    await page.getByRole("button", { name: "Play route", exact: true }).click();
    await expect.poll(async () => Number(await progress.inputValue())).toBeGreaterThan(1010);
  });
}
