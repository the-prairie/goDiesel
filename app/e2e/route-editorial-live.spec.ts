import {expect,test} from '@playwright/test';

test.skip(!process.env.GODIESEL_EDITORIAL_LIVE,'Explicit live editorial and UX review');
for(const width of [390,1280]) {
 test(`route editorial and discovery visual review at ${width}px`,async({page})=>{
  test.setTimeout(120_000);
  await page.setViewportSize({width,height:width===390?844:900});
  async function capture(name:string){
   await page.evaluate(()=>document.fonts.ready);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
   await page.screenshot({path:`artifacts/route-editorial-review/${name}-${width}.png`});
  }
  await page.goto('/#/finder');
  await expect(page.getByRole('region',{name:'Choose a starting place'})).toBeVisible();
  await capture('finder-start');
  await page.getByRole('button',{name:'Kyoto, Japan, 2 routes',exact:true}).click();
  await expect(page.getByRole('region',{name:'Finder route map'})).toHaveAttribute('data-map-status','ready',{timeout:30_000});
  await page.getByRole('button',{name:'Zoom planning map in'}).click();
  await page.getByRole('button',{name:'Zoom planning map out'}).click();
  await page.getByRole('button',{name:'Fit route to map'}).click();
  await page.waitForTimeout(600);
  await capture('finder-map');
  await page.goto('/#/atlas');
  await page.getByRole('button',{name:'Open Atlas options'}).click();
  await capture('atlas-places');
  await page.getByRole('textbox',{name:'Search places and routes'}).fill('London');
  await expect(page.getByRole('option')).toHaveCount(1);
  await capture('atlas-filtered');
  await page.getByRole('option',{name:'London, UK',exact:true}).click();
  await expect(page).toHaveURL(/region=London/);
  for(const slug of ['14486170630','9844581410','15573295095','13941094274']){
   await page.goto(`/#/routes/${slug}`);
   await expect(page.getByRole('region',{name:'Route geography'})).toHaveAttribute('data-map-status','ready',{timeout:30_000});
   if(width<768)await page.getByRole('button',{name:'Expand route margin'}).click();
   const article=page.getByRole('article',{name:'Route guide'});
   await expect(article.locator('.story-copy').first()).toHaveCSS('font-family',/Inter/);
   await article.locator('.story-copy').first().scrollIntoViewIfNeeded();
   await capture(`guide-${slug}`);
  }
 });
}
