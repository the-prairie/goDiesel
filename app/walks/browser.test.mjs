import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run } from './run.mjs';
import { serveFixture } from './test/fixture.mjs';
import { domBrowser } from './test/dom-browser.mjs';
const domOnly = process.env.GODIESEL_WALK_DOM_FIXTURE === '1';
async function dependencies(root, fixture, options) {
  return { repositoryRoot: root, ...(domOnly ? { chromium: await domBrowser(fixture.target, options) } : {}) };
}

// These are black-box HARNESS tests. The fixture is intentionally independent of app code.
for (const mission of ['memory', 'planning']) {
  test(`independent browser fixture completes ${mission} with real screenshots`, { timeout: 90000 }, async () => {
    const fixture = await serveFixture(); const root = await mkdtemp(path.join(tmpdir(), 'walk-browser-'));
    try {
      const result = await run({ target: fixture.target, mission, timeBudgetSeconds: 75 }, await dependencies(root, fixture));
      const report = JSON.parse(await readFile(path.join(root, result.report), 'utf8'));
      assert.equal(result.status, 'passed', JSON.stringify(report.findings));
      assert(report.actions.length >= 8); assert(report.checkpoints.length >= 3);
      assert(report.checkpoints.every(c => c.image.endsWith('.png')));
      assert.equal(report.experience_review.status, 'not_run');
      assert.equal(fixture.writes.length, 0);
      assert.equal(report.requests.total === 0, domOnly);
      if (!domOnly) assert(report.served_build.asset_fingerprints.length > 0);
    } finally { await fixture.close(); await rm(root, { recursive: true, force: true }); }
  });
}
test('mutation probe: a broken return link is a failed journey, never healed', { timeout: 90000 }, async () => {
  const fixture = await serveFixture({ brokenReturn: true }); const root = await mkdtemp(path.join(tmpdir(), 'walk-broken-'));
  try {
    const result = await run({ target: fixture.target, mission: 'memory', timeBudgetSeconds: 75 }, await dependencies(root, fixture, { brokenReturn: true }));
    const report = JSON.parse(await readFile(path.join(root, result.report), 'utf8'));
    assert.equal(result.status, 'failed');
    assert(report.findings.some(f => f.code === 'RETURN_CONTEXT'));
  } finally { await fixture.close(); await rm(root, { recursive: true, force: true }); }
});
test('budget interruption produces a blocked artifact', { timeout: 30000 }, async () => {
  const fixture = await serveFixture(); const root = await mkdtemp(path.join(tmpdir(), 'walk-budget-'));
  try {
    const result = await run({ target: fixture.target, mission: 'memory', ...(domOnly ? { actionBudget: 1 } : { requestBudget: 1 }), timeBudgetSeconds: 8 }, await dependencies(root, fixture));
    assert.equal(result.status, 'blocked');
    const report = JSON.parse(await readFile(path.join(root, result.report), 'utf8'));
    assert(report.findings.some(f => ['TIME_BUDGET', 'REQUEST_BUDGET', 'ACTION_BUDGET'].includes(f.code)));
  } finally { await fixture.close(); await rm(root, { recursive: true, force: true }); }
});
