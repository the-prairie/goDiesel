import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';

test.skip(!process.env.GODIESEL_ATLAS_PREVIEW_URL, 'Live Atlas is opt-in.');
for (const viewport of [{width:390,height:844},{width:684,height:724},{width:1440,height:900}]) {
  test(`Bali globe stays coherent after regional zoom at ${viewport.width}px`, async ({browser}, testInfo) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({viewport, deviceScaleFactor:2});
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(`${process.env.GODIESEL_ATLAS_PREVIEW_URL}/#/atlas?region=Bali%2C+Indonesia&route=10082410891`);
      const canvas = page.getByLabel('Interactive route globe');
      await expect(page.locator('div[data-atlas-engine="cesium"]')).toHaveAttribute('data-atlas-status','region-ready',{timeout:60_000});
      await page.screenshot({path:`artifacts/globe-quality/bali-region-${viewport.width}.png`});
      expect(Number(await canvas.getAttribute('data-render-scale'))).toBeGreaterThan(1);
      for (let count=0;count<20;count++) await page.getByRole('button',{name:'Zoom out',exact:true}).click();
      await expect.poll(async()=>Number(await canvas.getAttribute('data-camera-pitch'))).toBeLessThan(-1.56);
      expect(Number(await canvas.getAttribute('data-camera-height'))).toBeLessThanOrEqual(26_000_001);
      await page.waitForTimeout(1500);
      const shot=await page.screenshot({path:`artifacts/globe-quality/bali-orbit-${viewport.width}.png`});
      await testInfo.attach('orbital-globe',{body:shot,contentType:'image/png'});
      // A detached, bright atmospheric band produced hundreds of contiguous
      // white pixels per scanline. UI text and the legitimate limb are thin.
      const pixels=PNG.sync.read(await canvas.screenshot());
      const canvasBounds=(await canvas.boundingBox())!;
      const scale=pixels.width / canvasBounds.width;
      const trayBounds=(await page.getByRole('region',{name:'Bali, Indonesia routes',exact:true}).boundingBox())!;
      // Canvas screenshots also composite DOM overlays. Stop above the tray
      // and its credit strip so underlined attribution links aren't mistaken
      // for a detached atmospheric band.
      const mapBottom=Math.min(canvasBounds.height,trayBounds.y-canvasBounds.y)-40;
      let longestWhiteRun=0;
      for(let y=Math.round(130*scale);y<Math.round(mapBottom*scale);y++) {
        let run=0;
        for(let x=Math.round(10*scale);x<pixels.width-Math.round(65*scale);x++) {
          const offset=(y*pixels.width+x)*4;
          if(pixels.data[offset]>235 && pixels.data[offset+1]>235 && pixels.data[offset+2]>235) run++; else run=0;
          longestWhiteRun=Math.max(longestWhiteRun,run);
        }
      }
      expect(longestWhiteRun/scale).toBeLessThan(60);
      await page.getByRole('button',{name:'Next route',exact:true}).click();
      await expect(canvas).toHaveAttribute('data-selected-route','10075093128');
      await page.getByRole('link',{name:'Return to global Atlas',exact:true}).click();
      await expect(page.locator('div[data-atlas-engine="cesium"]')).toHaveAttribute('data-atlas-status','ready');
      await page.waitForTimeout(1500);
      await page.screenshot({path:`artifacts/globe-quality/global-${viewport.width}.png`});
      await page.getByRole('button',{name:'Zoom in',exact:true}).click();
      await page.getByRole('button',{name:'Reset globe view',exact:true}).click();
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  });
}
