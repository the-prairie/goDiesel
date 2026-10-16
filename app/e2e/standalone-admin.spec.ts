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

test('standalone mutation failures retain patches for retry', async ({ page, adminUrl }) => {
  await page.goto(adminUrl);
  await page.getByPlaceholder('Custom title').fill('Retained draft');
  await page.route('**/api/save', route => route.fulfill({ json: { ok: false } }));
  await page.locator('#saveBtn').click();
  await expect(page.locator('#toast')).toHaveText('SAVE FAILED');
  await expect(page.locator('#dirtyCount')).toHaveText('1');
  await expect(page.getByPlaceholder('Custom title')).toHaveValue('Retained draft');
  await page.unroute('**/api/save');
  await page.locator('#saveBtn').click();
  await expect(page.locator('#toast')).toHaveText('SAVED 1 CHANGE');
});

test('standalone save retains edits made while saving and allows a second save', async ({ page, adminUrl }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/save', async route => { await held; await route.continue(); });
  await page.goto(adminUrl);
  await page.getByPlaceholder('Custom title').fill('Submitted draft');
  const sent = page.waitForRequest('**/api/save');
  await page.locator('#saveBtn').click();
  await sent;
  await page.getByPlaceholder('Custom title').fill('Newer draft');
  await page.getByPlaceholder('Custom title').blur();
  release();
  await expect(page.locator('#toast')).toHaveText('SAVED 1 CHANGE');
  await expect(page.getByPlaceholder('Custom title')).toHaveValue('Newer draft');
  await expect(page.locator('#dirtyCount')).toHaveText('1');
  await page.locator('#saveBtn').click();
  await expect(page.locator('#dirtyCount')).toHaveText('0');
  await page.reload();
  await expect(page.getByPlaceholder('Custom title')).toHaveValue('Newer draft');
});

test('standalone rebuild reports HTTP errors and permits retry', async ({ page, adminUrl }) => {
  await page.route('**/api/rebuild', route => route.fulfill({ status: 503, json: { error: 'Unavailable' } }));
  await page.goto(adminUrl);
  await page.locator('#rebuildBtn').click();
  await expect(page.locator('#toast')).toHaveText('REBUILD FAILED');
  await page.unroute('**/api/rebuild');
  await page.locator('#rebuildBtn').click();
  await expect(page.locator('#toast')).toContainText('REBUILD STARTED');
});

test('standalone pending save survives classifier refresh and rejects duplicate submission', async ({ page, request, adminUrl }) => {
  await request.post(`${adminUrl}/fixture/mutations`, { data: { holdSaves: true } });
  await page.clock.install();
  await page.goto(adminUrl);
  await page.getByPlaceholder('Custom title').fill('Saved snapshot');
  await page.locator('#saveBtn').click();
  await expect(page.locator('#saveBtn')).toBeDisabled();
  await page.getByPlaceholder('Custom title').fill('Retained while classifier refreshes');
  await page.getByPlaceholder('Custom title').blur();
  await page.locator('#autoClassifyBtn').click();
  await request.post(`${adminUrl}/fixture/classification`, { data: { running: false, total: 2, updated: 2, done: 2, unmapped: 0 } });
  await page.clock.fastForward(2000);
  await expect(page.locator('#classifyStatus')).toContainText('CLASSIFIED 2 / 2');
  await expect.poll(async () => (await (await request.get(`${adminUrl}/fixture/calls`)).json()).routeReads).toBe(2);
  await expect(page.getByPlaceholder('Custom title')).toHaveValue('Retained while classifier refreshes');
  await expect(page.locator('#saveBtn')).toBeDisabled();
  await request.post(`${adminUrl}/fixture/release-saves`);
  await expect(page.locator('#saveBtn')).toBeEnabled();
  await expect(page.getByPlaceholder('Custom title')).toHaveValue('Retained while classifier refreshes');
  expect((await (await request.get(`${adminUrl}/fixture/calls`)).json()).saves).toHaveLength(1);
});

test('standalone save settles after a failed refresh and allows a later edit', async ({ page, adminUrl }) => {
  await page.goto(adminUrl);
  await page.getByPlaceholder('Custom title').fill('Persisted before refresh failure');
  await page.route('**/api/routes', route => route.abort());
  await page.locator('#saveBtn').click();
  await expect(page.locator('#toast')).toHaveText('SAVE FAILED');
  await expect(page.locator('#dirtyCount')).toHaveText('0');
  await page.getByPlaceholder('Custom title').fill('Retry after failure');
  await expect(page.locator('#saveBtn')).toBeEnabled();
  await page.unroute('**/api/routes');
  await page.locator('#saveBtn').click();
  await expect(page.locator('#toast')).toHaveText('SAVED 1 CHANGE');
  await page.reload();
  await expect(page.getByPlaceholder('Custom title')).toHaveValue('Retry after failure');
});

test('classifier refreshes after five new updates and resets the threshold on reconnect', async ({ page, request, adminUrl }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:00:00Z'));
  await request.post(`${adminUrl}/fixture/classification`, { data: { running: true, total: 20, done: 4, updated: 4 } });
  await page.goto(adminUrl);
  await expect(page.locator('#classifyStatus')).toContainText('CLASSIFYING 4 / 20');
  expect((await (await request.get(`${adminUrl}/fixture/calls`)).json()).routeReads).toBe(1);
  for (const [count, reads] of [[5, 2], [9, 2], [10, 3]]) {
    await request.post(`${adminUrl}/fixture/classification`, { data: { running: true, total: 20, done: count, updated: count } });
    await page.clock.fastForward(2000);
    await expect(page.locator('#classifyStatus')).toContainText(`CLASSIFYING ${count} / 20`);
    await expect.poll(async () => (await (await request.get(`${adminUrl}/fixture/calls`)).json()).routeReads).toBe(reads);
  }
  await page.reload();
  await expect(page.locator('#classifyStatus')).toContainText('CLASSIFYING 10 / 20');
  await expect.poll(async () => (await (await request.get(`${adminUrl}/fixture/calls`)).json()).routeReads).toBe(5);
});

test('classifier completion fades after eight seconds and stops polling', async ({ page, request, adminUrl }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:00:00Z'));
  await request.post(`${adminUrl}/fixture/classification`, { data: { running: false, total: 8, done: 8, updated: 7, unmapped: 1 } });
  await page.goto(adminUrl);
  await expect(page.locator('#classifyStatus')).toHaveText('✓ CLASSIFIED 7 / 8 · 1 still unmapped');
  await expect.poll(async () => (await (await request.get(`${adminUrl}/fixture/calls`)).json()).routeReads).toBe(2);
  await page.clock.fastForward(7999);
  await expect(page.locator('#classifyStatus')).toContainText('CLASSIFIED');
  await page.clock.fastForward(1);
  await expect(page.locator('#classifyStatus')).toBeEmpty();
  expect((await (await request.get(`${adminUrl}/fixture/calls`)).json()).polls).toBe(1);
});

test('classifier poll failure stops until a new start retries', async ({ page, request, adminUrl }) => {
  await page.clock.install();
  await page.route('**/api/classify-status', route => route.abort());
  await page.goto(adminUrl);
  await expect(page.locator('#classifyStatus')).toHaveText('CHECK FAILED');
  await expect(page.locator('#autoClassifyBtn')).toBeEnabled();
  await page.clock.fastForward(10000);
  expect((await (await request.get(`${adminUrl}/fixture/calls`)).json()).polls).toBe(0);
  await page.unroute('**/api/classify-status');
  await page.locator('#autoClassifyBtn').click();
  await expect(page.locator('#classifyStatus')).toContainText('CLASSIFYING 1 / 2');
});

test('classifier start network failure retains its notice and allows retry', async ({ page, adminUrl }) => {
  await page.goto(adminUrl);
  await expect(page.locator('#classifyStatus')).toContainText('1 unmapped');
  await page.route('**/api/auto-classify', route => route.abort());
  await page.locator('#autoClassifyBtn').click();
  await expect(page.locator('#toast')).toHaveText('AUTO-CLASSIFY FAILED');
  await expect(page.locator('#classifyStatus')).toContainText('1 unmapped');
  await expect(page.locator('#autoClassifyBtn')).toBeEnabled();
  await page.unroute('**/api/auto-classify');
  await page.locator('#autoClassifyBtn').click();
  await expect(page.locator('#classifyStatus')).toContainText('CLASSIFYING 1 / 2');
});
