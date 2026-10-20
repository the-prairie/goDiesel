import { expect, test } from '@playwright/test';
test.skip(process.env.GODIESEL_LIVE_GOOGLE_3D_E2E !== '1', 'Live Google 3D verification is opt-in.');
for (const width of [390, 1280]) {
  test(`Bali camera and distance-aligned thread at ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/#/replay/10082410891');
    const navigator = page.getByTestId('replay-stage');
    await expect(navigator).toHaveAttribute('data-state', 'ready', {timeout:40_000});
    const progress = page.getByLabel('Route progress', {exact:true});
    await progress.fill('9000');
    await expect(progress).toHaveValue('9000');
    await page.waitForTimeout(8_000);
    await page.getByRole('button',{name:'Playback speed 1x'}).click();
    await page.getByRole('button',{name:'Playback speed 2x'}).click();
    await page.getByRole('button',{name:'Play route',exact:true}).click();
    const motion = await page.locator('gmp-map-3d').evaluate(async element => {
      const map = element as google.maps.maps3d.Map3DElement;
      const samples: {time:number; heading:number; tilt:number; range:number}[] = [];
      const start = performance.now();
      await new Promise<void>(resolve => {
        const sample = (frameTime: number) => {
          samples.push({ time:frameTime, heading:map.heading ?? 0, tilt:map.tilt ?? 0, range:map.range ?? 0 });
          if (performance.now() - start < 6000) requestAnimationFrame(sample); else resolve();
        };
        requestAnimationFrame(sample);
      });
      return samples;
    });
    const speeds = motion.slice(1).map((sample,i) => Math.abs(((sample.heading-motion[i].heading+540)%360)-180) / ((sample.time-motion[i].time)/1000));
    await testInfo.attach('camera-motion', {body:JSON.stringify({maximumTurnDegreesPerSecond:Math.max(...speeds),samples:motion}),contentType:'application/json'});
    expect(Math.max(...speeds)).toBeLessThan(33);
    expect(motion.every(sample => Number.isFinite(sample.range) && sample.range > 300)).toBe(true);
    await page.getByRole('button',{name:'Pause route',exact:true}).click();
    await page.waitForTimeout(1_000);
    await page.screenshot({path:`artifacts/replay-comfort/bali-${width}.png`});
    const thread = page.locator('gmp-polyline-3d[data-thread-layer="thread"]');
    await expect(thread).toHaveAttribute('data-route-visible', 'true');
    await page.getByRole('button',{name:'Replay settings',exact:true}).click();
    const settings = page.getByRole('dialog',{name:'Replay settings'});
    await expect(settings).toBeVisible();
    await page.getByRole('button',{name:'Chase',exact:true}).click();
    await expect(navigator).toHaveAttribute('data-camera-mode','chase');
    await page.getByRole('button',{name:'Overview',exact:true}).click();
    await expect(navigator).toHaveAttribute('data-camera-mode','overview');
    await page.getByRole('button',{name:'Auto director',exact:true}).click();
    await page.getByRole('button',{name:'Explore freely',exact:true}).click();
    await expect(navigator).toHaveAttribute('data-following','false');
    await page.getByRole('button',{name:'Follow route',exact:true}).click();
    await expect(navigator).toHaveAttribute('data-following','true');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    expect(errors).toEqual([]);
  });
}
