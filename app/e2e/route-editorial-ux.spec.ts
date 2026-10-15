import { expect, test } from '@playwright/test';

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }, { width: 390, height: 320 }]) {
  test(`Atlas place browser is legible, filterable and keyboard usable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/#/atlas');
    await page.getByRole('button', { name: 'Open Atlas options' }).click();
    const list = page.getByRole('listbox', { name: 'Browse route regions' });
    await expect(list).toBeVisible();
    await expect(page.locator('#atlas-search-options select')).toHaveCount(0);
    const filter = page.getByRole('textbox', { name: 'Search places and routes' });
    await filter.fill('zzzzz');
    await expect(page.getByRole('region', {name:'Atlas search'}).getByRole('status')).toContainText('No places or routes match');
    await filter.fill('Kyoto');
    await expect(list.getByRole('option')).toHaveCount(1);
    await filter.press('ArrowDown');
    await expect(list.getByRole('option', { name: 'Kyoto, Japan', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/region=Kyoto/);
    await expect(list).toBeHidden();
    await expect(page.getByRole('button', { name: 'Open Atlas options' })).toBeFocused();
    await page.getByRole('button', { name: 'Open Atlas options' }).click();
    await expect(list.getByRole('option', { name: 'Kyoto, Japan', exact: true })).toHaveAttribute('aria-selected','true');
    await page.getByRole('textbox', { name: 'Search places and routes' }).press('Escape');
    await expect(list).toBeHidden();
  });
}
for (const width of [390,1280]) {
  test(`Finder has one useful starting state and route map controls at ${width}px`, async ({ page }) => {
    await page.setViewportSize({width,height:900});
    await page.goto('/#/finder');
    await expect(page.getByRole('region',{name:'Choose a starting place'})).toBeVisible();
    await expect(page.getByRole('region',{name:'Finder route map'})).toHaveCount(0);
    await expect(page.getByText('Source-backed candidate geometry',{exact:false})).toHaveCount(0);
    await page.getByRole('button',{name:'Kyoto',exact:true}).click();
    if (width < 1024) await page.getByRole('button',{name:'Map',exact:true}).click();
    const map = page.getByRole('region',{name:'Finder route map'});
    await expect(map).toHaveAttribute('data-map-status','ready');
    for (const name of ['Zoom planning map in','Zoom planning map out','Fit route to map']) {
      const button=page.getByRole('button',{name,exact:true});
      await expect(button).toBeVisible();
      await button.click();
    }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.goto('/#/routes/14486170630');
    if(width<768) await page.getByRole('button',{name:'Expand route margin'}).click();
    const prose = page.getByRole('article',{name:'Route guide'}).locator('.story-copy').first();
    await expect(prose).toHaveCSS('font-family', /Inter/);
    await expect(prose).toHaveCSS('font-weight','400');
  });
}

test('Victoria starting place uses its available ride and distance', async ({ page }) => {
  await page.goto('/#/finder');
  await page.getByRole('button', {name:'Victoria',exact:true}).click();
  await expect(page).toHaveURL(/place=Victoria&activity=Ride&distance=85/);
  await expect(page.getByRole('heading',{name:'1 route to explore'})).toBeVisible();
  await expect(page.getByRole('region',{name:'Finder route map'})).toHaveAttribute('data-map-status','ready');
});

for (const width of [390, 1280]) {
  test(`adversarial discovery regressions at ${width}px`, async ({page}) => {
    await page.setViewportSize({width,height:844});
    await page.goto('/#/atlas?region=London%2C+UK');
    const search=page.getByRole('region',{name:'Atlas search'});
    await search.getByRole('button',{name:'Open Atlas options'}).click();
    await expect(search.getByRole('textbox')).toHaveCount(1);
    const selected=search.getByRole('option',{name:'London, UK',exact:true});
    await expect(selected).toBeInViewport();
    await search.getByRole('textbox').fill('Kyoto');
    await search.getByRole('option',{name:'Kyoto, Japan',exact:true}).click();
    await expect(page).toHaveURL(/region=Kyoto/);
    await page.goto('/#/finder?place=Kyoto&activity=Run&distance=21&terrain=mixed');
    const card=page.getByRole('article',{name:'Kyoto, Japan candidate'});
    await expect(card.getByText(/680 m up/)).toBeVisible();
    await expect(card.getByText(/^21.3 km.*680 m up$/)).toBeVisible();
    await card.getByRole('link',{name:'Route guide',exact:true}).click();
    const margin=page.getByRole('complementary',{name:'Route margin'});
    await margin.getByRole('button',{name:'Read guide',exact:true}).click();
    await expect(margin.getByRole('heading',{name:'What it feels like'})).toBeInViewport();
    await page.getByRole('link',{name:'Back to Finder',exact:true}).click();
    await expect(page).toHaveURL(/finder\?place=Kyoto&activity=Run&distance=21&terrain=mixed$/);
    await expect(card).toBeVisible();
    await page.goto('/#/routes/9844581410');
    await page.getByRole('button',{name:'Read guide',exact:true}).click();
    await expect(page.getByText('Draft guide', {exact:true})).toBeInViewport();
    await expect(page.getByText(/AI-written/)).toHaveCount(0);
    await expect(page.getByRole('heading', {name:'About this guide',exact:true})).toHaveCount(0);
  });
}
