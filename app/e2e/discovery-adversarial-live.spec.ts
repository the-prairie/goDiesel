import {expect,test} from '@playwright/test';

test.skip(!process.env.GODIESEL_DISCOVERY_REVIEW_LIVE, 'Explicit discovery visual review');
for(const width of [390,1280]) {
 test(`adversarial discovery visual follow-up at ${width}px`,async({page})=>{
  test.setTimeout(120_000);
  await page.setViewportSize({width,height:width===390?844:900});
  async function capture(name:string){
   await page.evaluate(()=>document.fonts.ready);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
   await page.screenshot({path:`artifacts/discovery-adversarial/${name}-${width}.png`});
  }
  await page.goto('/#/finder');
  await expect(page.getByRole('region',{name:'Choose a starting place'})).toBeVisible();
  await capture('finder-start');
  await page.getByRole('button',{name:'Kyoto',exact:true}).click();
  await expect(page.getByRole('region',{name:'Finder route map'})).toHaveAttribute('data-map-status','ready',{timeout:30_000});
  const card=page.getByRole('article',{name:'Kyoto, Japan candidate'});
  await expect(card.getByText('680 m',{exact:true})).toBeVisible();
  await capture('finder-map');
  await card.getByRole('link',{name:'Route guide',exact:true}).scrollIntoViewIfNeeded();
  await capture('finder-actions');
  await card.getByRole('link',{name:'Route guide',exact:true}).click();
  await page.getByRole('button',{name:'Read guide',exact:true}).click();
  await expect(page.getByRole('heading',{name:'What it feels like'})).toBeInViewport();
  await page.getByRole('link',{name:'Back to Finder'}).click();
  await expect(page).toHaveURL(/finder\?place=Kyoto&activity=Run&distance=21$/);
  await page.goto('/#/routes/9844581410');
  await expect(page.getByRole('region',{name:'Route geography'})).toHaveAttribute('data-map-status','ready',{timeout:30_000});
  await page.getByRole('button',{name:'Read guide',exact:true}).click();
  await expect(page.getByText('Draft guide', {exact:true})).toBeInViewport();
    await expect(page.getByText(/AI-written/)).toHaveCount(0);
    await expect(page.getByRole('heading', {name:'About this guide',exact:true})).toHaveCount(0);
  await expect(page.getByLabel('Route guide content',{exact:true})).toBeFocused();
  await page.waitForTimeout(500);
  await capture('guide-draft');
  await page.goto('/#/atlas?region=London%2C+UK');
  await expect(page.locator('div[data-atlas-engine="cesium"]')).toHaveAttribute('data-atlas-status','region-ready',{timeout:60_000});
  await page.waitForTimeout(1500);
  await page.getByRole('button',{name:'Open Atlas options'}).click();
  const input=page.getByRole('textbox',{name:'Search places and routes'});
  await expect(page.getByRole('option',{name:'London, UK',exact:true})).toBeInViewport();
  await input.press('ArrowDown');
  await expect(page.getByRole('option',{name:'London, UK',exact:true})).toBeFocused();
  await capture('atlas-selected');
  await input.fill('Kyoto');
  await expect(page.getByRole('option',{name:'Kyoto, Japan',exact:true})).toBeVisible();
  await capture('atlas-switch-place');
  await page.getByRole('option',{name:'Kyoto, Japan',exact:true}).click();
  await expect(page).toHaveURL(/region=Kyoto/);
  await page.getByRole('button',{name:'Open Atlas options'}).click();
  await input.fill('zzzzzz');
  await page.getByRole('button',{name:'Browse all places'}).click();
  await expect(input).toHaveValue('');
  await expect(page.getByRole('option',{name:'Kyoto, Japan',exact:true})).toBeInViewport();
 });
}
