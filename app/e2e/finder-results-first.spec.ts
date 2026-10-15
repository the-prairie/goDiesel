import { expect, test } from '@playwright/test';
for (const width of [390, 684, 1280]) {
  test(`results-first beach search and map selection at ${width}`, async ({ page }) => {
    await page.setViewportSize({width, height:844});
    await page.goto('/#/finder?place=beach&activity=Run&distance=20&q=beach');
    const cards = page.getByRole('article');
    await expect(cards).toHaveCount(2);
    await expect(cards.first()).toContainText('23.2 km');
    await expect(cards.last()).toContainText('17.3 km');
    await expect(page.getByRole('button',{name:'Clear location filter'})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Clear experience search'})).toBeVisible();
    if(width<1024) {
      await expect(page.getByRole('button',{name:'List',exact:true})).toHaveAttribute('aria-pressed','true');
      await expect(cards.first()).toBeInViewport();
      await expect(page.getByRole('region',{name:'Finder route map'})).toBeHidden();
    }
    await cards.last().getByRole('button',{name:'Preview Bali, Indonesia on map'}).click();
    await expect(page.getByLabel('Selected map route')).toContainText('Bali, Indonesia');
    await expect(page.getByRole('region',{name:'Finder route map'})).toHaveAttribute('data-selected-route','9959792315');
    await expect(page.getByRole('region',{name:'Finder route map'})).toHaveAttribute('data-map-status','ready');
    await page.getByRole('button',{name:'Fit route to map'}).click();
    await page.screenshot({path:`artifacts/finder-results-first/map-${width}.png`});
    if(width<1024) await page.getByRole('button',{name:'List',exact:true}).click();
    await cards.last().getByRole('link',{name:'Route guide'}).click();
    await page.getByRole('link',{name:'Back to Finder'}).click();
    await expect(cards).toHaveCount(2);
    await expect(cards.last()).toHaveAttribute('data-selected','true');
    await page.screenshot({path:`artifacts/finder-results-first/list-${width}.png`});
    await page.getByRole('button',{name:'Clear experience search'}).click();
    await expect(page.getByRole('textbox',{name:'Describe your next route'})).toHaveValue('');
    await expect.poll(() => cards.count()).toBeGreaterThan(2);
    await expect(page).not.toHaveURL(/[?&]q=/);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
test('discovery requests a location separately and preserves the experience', async ({page})=>{
  let requestedPlace='';
  await page.route('**/api/discovery?**', route=>{
    requestedPlace=new URL(route.request().url()).searchParams.get('place') ?? '';
    return route.fulfill({json:{places:[{name:'Brighton, England',lat:50.82,lng:-0.14}]}});
  });
  await page.goto('/#/finder?place=beach&activity=Run&distance=20&q=beach');
  await page.getByRole('button',{name:'Discover new routes'}).click();
  await expect(page.getByRole('textbox',{name:'Near where?'})).toHaveValue('');
  await expect(page.getByText('Looking for: beach.',{exact:false})).toBeVisible();
  await expect(page.getByRole('button',{name:'Search new routes'})).toBeDisabled();
  await page.getByRole('textbox',{name:'Near where?'}).fill('Brighton');
  await page.getByRole('button',{name:'Search new routes'}).click();
  await expect(page.getByRole('button',{name:'Brighton, England'})).toBeVisible();
  expect(requestedPlace).toBe('Brighton');
  await expect(page.getByRole('textbox',{name:'Describe your next route'})).toHaveValue('beach');
  await page.getByRole('button',{name:'My collection · 67'}).click();
  await expect(page.getByRole('article')).toHaveCount(2);
  await page.getByRole('button',{name:'Discover new routes'}).click();
  await expect(page.getByRole('textbox',{name:'Near where?'})).toHaveValue('Brighton');
  await page.getByRole('button',{name:'Edit distance target'}).click();
  await page.getByRole('spinbutton',{name:'Distance km',exact:true}).fill('10');
  await page.getByRole('button',{name:'Find routes',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Near where?'})).toHaveValue('Brighton');
});
