/** HTTP-only proof of the controlled fault. Do not run through the DOM-only fixture adapter. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { run } from './run.mjs';
import { serveFixture } from './test/fixture.mjs';

test('one real HTTP route fault recovers without substituting the second response', { timeout: 40000 }, async () => {
  assert.notEqual(process.env.GODIESEL_WALK_DOM_FIXTURE, '1', 'This proof needs the real HTTP fixture, not the DOM adapter.');
  const fixture = await serveFixture({ httpDetails: true });
  const root = await mkdtemp(path.join(tmpdir(), 'walk-recovery-'));
  try {
    const result = await run({ target: fixture.target, mission: 'recovery', timeBudgetSeconds: 30 }, { repositoryRoot: root });
    const report = JSON.parse(await readFile(path.join(root, result.report), 'utf8'));
    assert.equal(result.status, 'passed', JSON.stringify(report.findings));
    assert(report.checks.some(c => c.id === 'transient-route-recovery' && c.status === 'passed'));
    assert(report.observations.some(c => c.kind === 'controlled-fault'));
    assert.equal(fixture.writes.length, 0);
  } finally { await fixture.close(); await rm(root, { recursive: true, force: true }); }
});
