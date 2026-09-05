import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDecision, judgeMilestones, decisionSchema } from './agent.mjs';
import { requestBody, parseResponse, openaiDecision } from './agents/openai.mjs';
import { requireControlled, chooseIndex } from './extended.mjs';

const action = (type, fields = {}) => ({ type, role: null, name: null, value: null, amount: null, reason: 'Observe the app', ...fields });
const wrap = a => ({ observation_id: 'current-observation', action: a });
const valid = a => validateDecision(wrap(a), 'current-observation');

test('closed action protocol supports only bounded visible interactions', () => {
  for (const a of [action('click', { role: 'link', name: 'Routes' }), action('fill', { role: 'searchbox', name: 'Search routes', value: 'Kyoto' }), action('select', { role: 'combobox', name: 'Activity', value: 'Run' }), action('scroll', { amount: 500 }), action('wait', { amount: 200 }), action('reload'), action('press', { value: 'Escape' }), action('note'), action('finish')])
    assert.deepEqual(valid(a), a);
});
for (const [label, a] of Object.entries({
  arbitraryScript: action('evaluate', { value: 'fetch("evil")' }),
  arbitraryURL: action('goto', { value: 'https://evil.test' }),
  delete: action('click', { role: 'button', name: 'Delete plan' }),
  publish: action('click', { role: 'button', name: 'Publish' }),
  hiddenSubmit: action('press', { value: 'Enter' }),
  unboundedWait: action('wait', { amount: 60000 }),
  negativeWait: action('wait', { amount: -1 }),
  unboundedScroll: action('scroll', { amount: 900 }),
  noName: action('click', { role: 'button' }),
  tooLong: action('note', { reason: 'x'.repeat(601) }),
  extraField: { ...action('finish'), injected: true },
  secretField: action('fill', { role: 'password', name: 'Password', value: 'secret' }),
  vagueClick: action('click', { role: 'article', name: 'Route' }),
})) test(`agent boundary rejects ${label}`, () => assert.throws(() => valid(a)));

test('a decision from another observation is rejected', () => assert.throws(() => validateDecision(wrap(action('finish')), 'different')));

test('agent cannot award itself mission completion', () => {
  assert.equal(judgeMilestones('memory', [{ surface: 'atlas' }], 20), false);
  const marks = [{ surface: 'routes', slug: 'a', story: true }, { surface: 'replay', slug: 'a', progress: 0, playing: true }, { surface: 'replay', slug: 'a', progress: 1, playing: true }, { surface: 'routes', slug: 'a', story: true }];
  assert.equal(judgeMilestones('memory', marks, 8), true);
  assert.equal(judgeMilestones('memory', marks.map(m => ({ ...m, playing: false })), 8), false);
  assert.equal(judgeMilestones('memory', [...marks.slice(0, 3), { surface: 'routes', slug: 'b', story: true }], 8), false);
  assert.equal(judgeMilestones('planning', [{ saved: true }, { refreshed: true }, { plan: true }, { emptySearch: true }, { candidate: true }], 15), true);
  assert.equal(judgeMilestones('planning', [{ saved: true }, { plan: true }], 15), false);
  assert.equal(judgeMilestones('explore', [{ surface: 'atlas' }, { surface: 'routes' }], 5), true);
  assert.equal(judgeMilestones('explore', [{ surface: 'atlas' }, { surface: 'routes' }], 1), false);
});

test('live observations can never enable controlled faults', () => {
  assert.throws(() => requireControlled({ profile: 'live' }));
  assert.doesNotThrow(() => requireControlled({ profile: 'controlled' }));
  assert.equal(chooseIndex(50, 'day'), chooseIndex(50, 'day'));
  assert.throws(() => chooseIndex(0, 'day'));
});

test('model request contains one image and bounded data, with no tools or source access', () => {
  const body = requestBody({ screenshot: Buffer.from('image'), snapshot: 'visible UI' }, decisionSchema, 'explicit-model');
  assert.equal(body.store, false); assert.equal(body.max_output_tokens, 1600);
  assert.equal(body.tools, undefined);
  assert.equal(body.input[0].content[1].type, 'input_image');
  assert.equal(body.text.format.strict, true);
  assert.throws(() => requestBody({ screenshot: Buffer.from('x') }, decisionSchema, ''));
});

test('model refusal, incomplete output, missing usage and invalid JSON remain blocked', () => {
  for (const body of [{ status: 'incomplete' }, { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal' }] }] }, { status: 'completed', output: [] }, { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{}' }] }] }])
    assert.throws(() => parseResponse(body));
});

test('remote access is opt-in and errors never expose provider response bodies', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return { ok: false, status: 401, text: async () => 'secret credential' }; };
  await assert.rejects(() => openaiDecision({}, {}, { fetchImpl, environ: {} })); assert.equal(calls, 0);
  await assert.rejects(() => openaiDecision({ screenshot: Buffer.from('x') }, decisionSchema, { fetchImpl, environ: { OPENAI_API_KEY: 'secret', GODIESEL_WALK_MODEL: 'model', GODIESEL_WALK_ALLOW_REMOTE_AGENT: '1' } }), error => !error.message.includes('credential') && error.code === 'AGENT_UNAVAILABLE');
  assert.equal(calls, 1);
});
