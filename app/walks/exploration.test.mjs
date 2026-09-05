/** Browser-verifiable agent loop; the decision provider is an explicit deterministic fixture. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { run } from './run.mjs';
import { domBrowser } from './test/dom-browser.mjs';
import { serveFixture } from './test/fixture.mjs';

async function environment() {
  const root = await mkdtemp(path.join(tmpdir(), 'walk-exploration-'));
  const fixture = await serveFixture();
  return { root, fixture, deps: { repositoryRoot: root, ...(process.env.GODIESEL_WALK_DOM_FIXTURE === '1' ? { chromium: await domBrowser(fixture.target) } : {}) },
    close: async () => { await fixture.close(); await rm(root, { recursive: true, force: true }); } };
}
for (const mission of ['library', 'admin-readonly']) test(`${mission} crosses an independent browser fixture`, { timeout: 30000 }, async () => {
  const e = await environment();
  try {
    const result = await run({ target: e.fixture.target, mission, seed: '2026', timeBudgetSeconds: 20 }, e.deps);
    const report = JSON.parse(await readFile(path.join(e.root, result.report), 'utf8'));
    assert.equal(result.status, 'passed', JSON.stringify(report.findings));
    assert(report.checkpoints.length > 0); assert.equal(e.fixture.writes.length, 0);
  } finally { await e.close(); }
});

test('agent loop consumes fresh UI observations and independently judges completion', { timeout: 30000 }, async () => {
  const e = await environment(); let call = 0;
  const steps = [
    ['click', 'Routes'], ['click', 'Atlas'], ['click', 'Finder'], ['click', 'Routes'], ['click', 'Atlas'], ['finish', null],
  ];
  try {
    const decide = async input => {
      assert(Buffer.isBuffer(input.screenshot)); assert(input.snapshot.length > 0); assert.equal(input.source_code, undefined);
      const [type, name] = steps[call++];
      return { decision: { observation_id: input.observation_id, action: { type, role: type === 'click' ? 'link' : null, name, value: null, amount: null, reason: 'Independent test decision' } }, usage: { input_tokens: 10, output_tokens: 10 } };
    };
    const result = await run({ target: e.fixture.target, mission: 'explore', driver: 'agent', timeBudgetSeconds: 20 }, { ...e.deps, decide });
    const report = JSON.parse(await readFile(path.join(e.root, result.report), 'utf8'));
    assert.equal(result.status, 'passed', JSON.stringify(report.findings));
    assert.equal(report.agent.adapter, 'injected-test-adapter'); assert.equal(report.agent.calls, 6);
    assert.equal(report.experience_review.status, 'not_run'); assert.equal(e.fixture.writes.length, 0);
  } finally { await e.close(); }
});

test('agent claiming success without completing the journey is blocked', { timeout: 20000 }, async () => {
  const e = await environment();
  try {
    const decide = async input => ({ decision: { observation_id: input.observation_id, action: { type: 'finish', role: null, name: null, value: null, amount: null, reason: 'claiming success' } } });
    const result = await run({ target: e.fixture.target, mission: 'memory', driver: 'agent', timeBudgetSeconds: 10 }, { ...e.deps, decide });
    assert.equal(result.status, 'blocked');
  } finally { await e.close(); }
});
