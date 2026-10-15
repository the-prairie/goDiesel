import { expect, test } from "@playwright/test";

test.skip(!process.env.GODIESEL_DESIGN_REVIEW_LIVE, "Explicit live visual review only");
for (const width of [390, 1280]) {
  test(`settled whole-app design review at ${width}px`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    async function capture(name: string) {
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.screenshot({ path: `artifacts/active-theory-review/${name}-${width}.png` });
    }
    await page.goto('/#/atlas?region=Kyoto%2C+Japan');
    const tray = page.getByRole('region', {name:'Kyoto, Japan routes',exact:true});
    await expect(tray).toBeVisible({timeout:20_000});
    for (const thumb of await tray.locator('[data-route-thumbnail]').all()) {
      await expect(thumb).toHaveAttribute('data-thumbnail-state','loaded',{timeout:20_000});
    }
    await expect(page.locator('div[data-atlas-engine="cesium"]')).toHaveAttribute('data-atlas-status','region-ready',{timeout:60_000});
    await expect(page.getByLabel('Interactive route globe')).toHaveAttribute('data-camera-state','settled');
    await capture('atlas');
    await page.goto('/#/finder?place=Banff&activity=Run&distance=20');
    await expect(page.getByRole('region',{name:'Finder route map'})).toHaveAttribute('data-map-status','ready',{timeout:30_000});
    await expect(page.getByRole('article').first()).toBeVisible();
    await capture('finder');
    await page.goto('/#/routes?q=London');
    await expect(page.getByRole('heading',{name:'Places worth returning to.'})).toBeVisible();
    await expect(page.getByRole('article').first()).toBeVisible();
    await capture('routes');
    await page.goto('/#/routes/14486170630');
    const map = page.getByRole('region',{name:'Route geography'});
    await expect(map).toHaveAttribute('data-map-status','ready',{timeout:30_000});
    await expect(map.getByRole('button',{name:/recorded repair/i})).toHaveCount(0);
    await page.getByRole('button',{name:'Zoom route map in'}).click();
    await page.getByRole('button',{name:'Reset route map'}).click();
    await page.waitForTimeout(600); // camera's documented 450 ms reset transition
    await capture('guide');
    if (width < 768) await page.getByRole('button',{name:'Expand route margin'}).click();
    await expect(page.getByRole('heading',{name:'What it feels like'})).toBeAttached();
    await page.getByText('A half-marathon-sized sweep through London', {exact:false}).scrollIntoViewIfNeeded();
    await capture('guide-story');
    await page.goto('/#/replay/9844581410');
    await expect(page.getByTestId('replay-stage')).toHaveAttribute('data-state','ready',{timeout:60_000});
    await page.getByRole('button',{name:'Play route',exact:true}).click();
    await expect(page.getByRole('button',{name:'Pause route',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Pause route',exact:true}).click();
    await expect(page.getByTestId('replay-elevation-scrubber')).toHaveAttribute('data-playhead-color','#ffffff');
    await capture('replay');
    await page.getByRole('button',{name:'Replay settings',exact:true}).click();
    await expect(page.getByRole('complementary',{name:'Replay settings panel'})).toBeVisible();
    await capture('replay-settings');
    await page.goto('/#/admin');
    await page.getByRole('searchbox',{name:'Search owner routes'}).fill('Kyoto');
    const list = page.getByRole('complementary',{name:'Owner route list'});
    await expect(list.getByRole('button')).toHaveCount(2);
    await list.getByRole('button').nth(1).click();
    await expect(list.getByRole('button').nth(1)).toHaveAttribute('aria-pressed','true');
    await expect(list.getByRole('button').nth(1).locator('svg')).toHaveCSS('fill','rgb(255, 255, 255)');
    await expect(page.getByRole('region',{name:'Route curation editor'})).toBeVisible();
    await expect(page.getByText('No routes match this search.',{exact:true})).toHaveCount(0);
    await capture('admin');
  });
}
