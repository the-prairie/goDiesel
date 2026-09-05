import test from 'node:test';
import assert from 'node:assert/strict';

test('visibility selection resolves one current visible control without enumerating unstable collections', async () => {
  const { visible } = await import('./browser.mjs');
  let shown = true;
  const candidate = { isVisible: async () => shown };
  const locator = {
    filter: options => {
      assert.deepEqual(options, { visible: true });
      return { first: () => candidate };
    },
    all: () => assert.fail('must not enumerate a live collection of repeated links'),
  };
  assert.equal(await visible(locator), candidate);
  shown = false;
  assert.equal(await visible(locator), null);
});
