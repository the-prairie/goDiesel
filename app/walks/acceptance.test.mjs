import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from './acceptance.mjs';

const report = () => ({ checks: [{ id: 'mission', status: 'passed' }, { id: 'return-context', status: 'passed' }, { id: 'named-degradation', status: 'passed' }, { id: 'playback-progress', status: 'blocked' }], findings: [], actions: [{}], checkpoints: [{}], browser: { renderer: 'SwiftShader' }, requests: { provider_successes: { 'maps.googleapis.com': 1 } } });
const operator = status => ({ result: { status }, blockers: [] });

test('controlled round-trip acceptance cannot approve live imagery', () => {
  const r = report();
  assert.equal(summarize('controlled-memory', operator('blocked'), r).acceptance_status, 'passed');
  const live = summarize('live-memory', operator('blocked'), r);
  assert.equal(live.acceptance_status, 'blocked');
  assert.equal(live.imagery_approval, 'not_established');
  assert.equal(live.navigation_round_trip, 'passed');
});
test('missing report or operator rejection can never be accepted', () => {
  assert.equal(summarize('controlled-memory', operator('passed'), null).acceptance_status, 'blocked');
  assert.equal(summarize('controlled-memory', { ...operator('blocked'), blockers: [{ code: 'GODIESEL_WALK_INCOMPLETE_RESULT' }] }, report()).acceptance_status, 'blocked');
});
test('injected decisions and zero API calls cannot establish the live model experience', () => {
  const r = { ...report(), checks: [{ id: 'mission', status: 'passed' }], agent: { adapter: 'injected-test-adapter', calls: 10, input_tokens: 100, output_tokens: 100 } };
  assert.equal(summarize('model-planning', operator('passed'), r).acceptance_status, 'blocked');
  r.agent.adapter = 'openai-responses'; r.agent.calls = 0;
  assert.equal(summarize('model-planning', operator('passed'), r).model_mission, 'not_established');
  r.agent.calls = 10;
  assert.equal(summarize('model-planning', operator('passed'), r).model_mission, 'passed');
});
test('public summaries contain no arbitrary notes, provider URLs, route names, or error content', () => {
  const secret = 'PRIVATE_ROUTE_AND_TOKEN';
  const r = report(); r.findings.push({ code: secret, detail: secret }); r.browser.renderer = secret;
  r.checks.push({ id: secret, detail: secret, status: 'passed' });
  r.agent = { adapter: secret, calls: secret, input_tokens: secret, output_tokens: secret };
  r.requests.provider_successes = { [secret]: secret };
  const summary = summarize('live-memory', { ...operator('blocked'), blockers: [{ code: secret, message: secret }] }, r);
  assert.ok(!JSON.stringify(summary).includes(secret));
});
