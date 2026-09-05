import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { summarize } from './acceptance.mjs';

// These manufactured reports test classification only, never live acceptance.
function report(adapter) {
  return { checks: [{ id: 'mission', status: 'passed' }], findings: [], actions: [{}], checkpoints: [{}],
    agent: { adapter, calls: 2, input_tokens: 100, output_tokens: 40 } };
}
test('Vertex is a recognized live adapter; injected or zero-call reports are not', () => {
  const operator = { result: { status: 'passed' }, blockers: [] };
  assert.equal(summarize('model-planning', operator, report('vertex-gemini')).model_mission, 'passed');
  assert.equal(summarize('model-planning', operator, report('injected-test-adapter')).acceptance_status, 'blocked');
  const missing = report('vertex-gemini'); missing.agent.calls = 0;
  assert.equal(summarize('model-planning', operator, missing).acceptance_status, 'blocked');
});
test('local Vertex launcher contracts run without keys, browser or model access', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const result = spawnSync('python', ['test_walk_vertex_launcher.py'], { cwd: root, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
});
