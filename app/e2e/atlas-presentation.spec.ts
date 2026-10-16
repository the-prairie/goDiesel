import { expect, test, type Page } from '@playwright/test';
import type { AtlasWorldStatus } from '../src/surfaces/atlas/atlas-world';
import { installDeterministicCesiumAtlas } from './helpers/deterministic-atlas';

async function installControlledWorld(page: Page) {
  await page.addInitScript(() => {
    window.__ATLAS_PRESENTATION_TEST__ = { finishMount() {}, report() {}, worlds: [] };
    window.__GODIESEL_ATLAS_WORLD_FACTORY__ = () => {
      let container: HTMLElement;
      return {
        mount(options) {
          container = options.container;
          container.setAttribute('data-test-world', 'mounted');
          window.__ATLAS_PRESENTATION_TEST__.report = options.onStatus;
          return new Promise<void>(resolve => {
            window.__ATLAS_PRESENTATION_TEST__.finishMount = resolve;
            window.__ATLAS_PRESENTATION_TEST__.worlds.push({ finishMount: resolve, report: options.onStatus });
          });
        },
        setSelectedRegion(region) { container.dataset.selectedRegion = region?.name ?? ''; },
        setSelectedRoute(route) { container.dataset.selectedRoute = route?.slug ?? ''; },
        projectRegions: () => [], zoomIn() {}, zoomOut() {}, resetView() {}, destroy() {},
      };
    };
  });
}

const kyoto = { name: 'Kyoto, Japan recorded routes', exact: true };
const world = 'div[data-atlas-engine="cesium"]';

async function report(page: Page, status: AtlasWorldStatus) {
  await page.evaluate(value => window.__ATLAS_PRESENTATION_TEST__.report(value), status);
}

test('delayed mount uses the latest URL region and route', async ({ page }) => {
  await installControlledWorld(page);
  await page.goto('/#/atlas?region=Kyoto%2C+Japan');
  await expect(page.locator('[data-test-world]')).toBeAttached();
  await expect(page.getByText('Loading Kyoto, Japan terrain', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search places and routes' }).fill('London');
  await page.getByRole('option', { name: 'London, UK', exact: true }).click();
  await page.evaluate(() => window.__ATLAS_PRESENTATION_TEST__.finishMount());
  await expect(page.locator('[data-test-world]')).toHaveAttribute('data-selected-region', 'London, UK');
  await report(page, { state: 'region-ready', regionName: 'London, UK', message: 'London ready.' });
  await expect(page.getByRole('region', { name: 'London, UK recorded routes', exact: true })).toBeVisible();
  await expect(page.getByRole('region', kyoto)).toHaveCount(0);
  await expect(page.locator('[data-test-world]')).toHaveAttribute('data-selected-route', /\d+/);
});

test('public status preserves carousel readiness policies', async ({ page }) => {
  await installControlledWorld(page);
  await page.goto('/#/atlas?region=Kyoto%2C+Japan');
  await expect(page.locator('[data-test-world]')).toBeAttached();
  await page.evaluate(() => window.__ATLAS_PRESENTATION_TEST__.finishMount());
  const carousel = page.getByRole('region', kyoto);
  await report(page, { state: 'region-ready', regionName: 'Kyoto, Japan', message: 'Ready.' });
  await expect(carousel).toBeVisible();
  await report(page, { state: 'loading', message: 'Opening again.' });
  await expect(page.locator(world)).toHaveAttribute('data-atlas-status', 'loading');
  await expect(carousel).toBeVisible();
  await report(page, { state: 'region-loading', regionName: 'Kyoto, Japan', message: 'Loading terrain.' });
  await expect(carousel).toHaveCount(0);
  await report(page, { state: 'unavailable', message: 'Provider unavailable.' });
  await expect(carousel).toBeVisible();
  await expect(page.getByText('Provider unavailable. Search and navigation remain available.')).toBeVisible();
  await report(page, { state: 'ready', message: 'Global ready.' });
  await expect(carousel).toHaveCount(0);
});

test('route selection and browser history keep ready regional presentation', async ({ page }) => {
  await installDeterministicCesiumAtlas(page);
  await page.goto('/#/atlas?region=Kyoto%2C+Japan');
  const carousel = page.getByRole('region', kyoto);
  await expect(carousel).toBeVisible();
  await page.getByRole('button', { name: 'Next route', exact: true }).click();
  await expect(carousel.locator('article').nth(1)).toHaveAttribute('data-selected', 'true');
  await expect(page.getByLabel('Interactive route globe')).toHaveAttribute('data-region-selection-count', '1');
  await page.goBack();
  await expect(carousel.locator('article').first()).toHaveAttribute('data-selected', 'true');
  await expect(page.getByLabel('Interactive route globe')).toHaveAttribute('data-region-selection-count', '1');
  await page.getByRole('button', { name: 'Close Kyoto, Japan routes', exact: true }).click();
  await expect(carousel).toHaveCount(0);
  await page.goBack();
  await expect(carousel).toBeVisible();
});

test('fallback waits for its map before revealing the selected region', async ({ page }) => {
  await installControlledWorld(page);
  await page.route('**/styles/liberty', route => route.fulfill({ json: { version: 8, sources: {}, layers: [] } }));
  await page.goto('/#/atlas?region=Kyoto%2C+Japan');
  await expect(page.locator('[data-test-world]')).toBeAttached();
  await report(page, { state: 'region-fallback', regionName: 'Kyoto, Japan', message: 'Fallback.' });
  await expect(page.locator('[data-atlas-engine="maplibre-regional-fallback"]')).toHaveAttribute('data-map-status', 'ready');
  await expect(page.getByRole('region', kyoto)).toBeVisible();
});


test('replacement keeps the current world when an old mount or status completes', async ({ page }) => {
  await installControlledWorld(page);
  await page.goto('/#/atlas?region=Kyoto%2C+Japan');
  await expect(page.locator('[data-test-world]')).toBeAttached();
  await page.getByRole('button', { name: 'Show rides', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__ATLAS_PRESENTATION_TEST__.worlds.length)).toBe(2);
  await page.evaluate(() => {
    const worlds = window.__ATLAS_PRESENTATION_TEST__.worlds;
    worlds[1].finishMount();
    worlds[1].report({ state: 'ready', message: 'Current world.' });
  });
  await expect(page.locator(world)).toHaveAttribute('data-atlas-status', 'ready');
  await page.evaluate(() => {
    const oldWorld = window.__ATLAS_PRESENTATION_TEST__.worlds[0];
    oldWorld.finishMount();
    oldWorld.report({ state: 'unavailable', message: 'Retired world failure.' });
  });
  await expect(page.locator(world)).toHaveAttribute('data-atlas-status', 'ready');
  await expect(page.getByText('Retired world failure.', { exact: false })).toHaveCount(0);
  await expect(page.locator('[data-test-world]')).toHaveAttribute('data-selected-region', '');
});

declare global {
  interface Window {
    __ATLAS_PRESENTATION_TEST__: {
      finishMount(): void; report(status: AtlasWorldStatus): void;
      worlds: Array<{ finishMount(): void; report(status: AtlasWorldStatus): void }>;
    };
  }
}
