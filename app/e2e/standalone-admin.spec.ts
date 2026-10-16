import { test as base, expect } from '@playwright/test';
import { startStandaloneAdminFixture } from './fixtures/standalone-admin-server.mjs';

const test = base.extend<{}, { adminUrl: string }>({
  adminUrl: [async ({}, use) => {
    const fixture = await startStandaloneAdminFixture();
    await use(fixture.url);
    await fixture.close();
  }, { scope: 'worker' }],
});

test.beforeEach(async ({ request, adminUrl }) => {
  await request.post(`${adminUrl}/fixture/reset`);
});

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test(`standalone admin edits, saves, refreshes and guards rebuild at ${viewport.width}`, async ({ page, request, adminUrl }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(adminUrl);
    await expect(page.getByText('Synthetic river run', { exact: true })).toBeVisible();
    await expect(page.locator('#cPending')).toHaveText('1');
    await expect(page.locator('#cApproved')).toHaveText('1');
    await expect(page.locator('#saveBtn')).toBeDisabled();
    await page.getByPlaceholder('Custom title').fill('River <loop> & "views"');
    await page.getByPlaceholder('Blurb', { exact: true }).fill('First line\nSecond line');
    await expect(page.locator('#dirtyCount')).toHaveText('1');
    await page.locator('#rebuildBtn').click();
    await expect(page.locator('#toast')).toHaveText('SAVE FIRST');
    expect((await (await request.get(`${adminUrl}/fixture/calls`)).json()).rebuilds).toBe(0);
    await page.locator('#saveBtn').click();
    await expect(page.locator('#toast')).toHaveText('SAVED 1 CHANGE');
    await expect(page.locator('#saveBtn')).toBeDisabled();
    await expect(page.getByPlaceholder('Custom title')).toHaveValue('River <loop> & "views"');
    await expect(page.getByPlaceholder('Blurb', { exact: true })).toHaveValue('First line\nSecond line');
    await page.reload();
    await expect(page.getByPlaceholder('Custom title')).toHaveValue('River <loop> & "views"');
    await page.locator('#rebuildBtn').click();
    await expect(page.locator('#toast')).toContainText('REBUILD STARTED');
    const calls = await (await request.get(`${adminUrl}/fixture/calls`)).json();
    expect(calls.saves).toEqual([[{ activity_id: 'synthetic-one', title: 'River <loop> & "views"', blurb: 'First line\nSecond line' }]]);
    expect(calls.rebuilds).toBe(1);
    expect(errors).toEqual([]);
  });
}

test('standalone admin reconnects to classification and polls every two seconds', async ({ page, request, adminUrl }) => {
  await request.post(`${adminUrl}/fixture/reset`, { data: { running: true, total: 8, done: 3, updated: 3, last_label: 'Test valley' } });
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:00:00Z'));
  await page.goto(adminUrl);
  await expect(page.locator('#classifyStatus')).toContainText('CLASSIFYING 3 / 8');
  await expect(page.locator('#autoClassifyBtn')).toBeDisabled();
  expect((await (await request.get(`${adminUrl}/fixture/calls`)).json()).starts).toBe(0);
  await request.post(`${adminUrl}/fixture/classification`, { data: { running: true, total: 8, done: 6, updated: 6, last_label: 'Test hills' } });
  await page.clock.fastForward(1999);
  await expect(page.locator('#classifyStatus')).toContainText('CLASSIFYING 3 / 8');
  await page.clock.fastForward(1);
  await expect(page.locator('#classifyStatus')).toContainText('CLASSIFYING 6 / 8');
  await expect.poll(async () => (await (await request.get(`${adminUrl}/fixture/calls`)).json()).routeReads).toBe(2);
  await request.post(`${adminUrl}/fixture/classification`, { data: { running: false, total: 8, done: 8, updated: 7, unmapped: 1 } });
  await page.clock.fastForward(2000);
  await expect(page.locator('#classifyStatus')).toContainText('CLASSIFIED 7 / 8');
  await expect(page.locator('#autoClassifyBtn')).toBeEnabled();
  await expect.poll(async () => (await (await request.get(`${adminUrl}/fixture/calls`)).json()).routeReads).toBe(3);
});

test('standalone admin starts classification and filters the preserved route list', async ({ page, adminUrl }) => {
  await page.goto(adminUrl);
  await expect(page.locator('#classifyStatus')).toContainText('1 unmapped');
  await page.locator('#autoClassifyBtn').click();
  await expect(page.locator('#classifyStatus')).toContainText('CLASSIFYING 1 / 2');
  await page.locator('[data-tab="approved"]').click();
  await expect(page.getByText('Synthetic hill ride', { exact: true })).toBeVisible();
  await page.locator('#search').fill('does not match');
  await expect(page.getByText('NO ROUTES MATCH THESE FILTERS')).toBeVisible();
  await page.locator('#search').fill('hill');
  await expect(page.getByText('Synthetic hill ride', { exact: true })).toBeVisible();
});

for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 640 }]) {
  test(`standalone admin keeps mobile controls within ${viewport.width}px`, async ({ page, adminUrl }) => {
    await page.setViewportSize(viewport);
    await page.goto(adminUrl);
    await expect(page.getByText('Synthetic river run', { exact: true })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    for (const selector of ['#saveBtn', '#rebuildBtn', '#autoClassifyBtn', '#regionSelect', '#search']) {
      const box = await page.locator(selector).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    }
    await page.getByPlaceholder('Custom title').fill('Mobile visible controls');
    await page.locator('#saveBtn').click();
    await expect(page.locator('#toast')).toHaveText('SAVED 1 CHANGE');
    await page.locator('#autoClassifyBtn').click();
    await expect(page.locator('#classifyStatus')).toContainText('CLASSIFYING 1 / 2');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  });
}
