import test from 'node:test';
import assert from 'node:assert/strict';
import { vertexConfiguration, vertexSchema, vertexRequest, parseVertexResponse, vertexDecision } from './agents/vertex.mjs';
import { configuredAgent, liveAdapterIds } from './agents/provider.mjs';

const schema = { type: 'object', additionalProperties: false, required: ['observation_id', 'action'], properties: {
  observation_id: { type: 'string' }, action: { type: 'object', additionalProperties: false,
    required: ['type', 'role'], properties: { type: { type: 'string', enum: ['finish'] }, role: { type: ['string', 'null'] } } },
} };
const decision = { observation_id: 'observed', action: { type: 'finish', role: null } };
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const input = { observation_id: 'observed', screenshot: image, snapshot: 'Observed interface', mission: 'Explore', history: [], remaining_actions: 10 };
const environ = { GODIESEL_WALK_PROVIDER: 'vertex', GODIESEL_WALK_ALLOW_REMOTE_AGENT: '1', GODIESEL_WALK_MODEL: 'gemini-example', GOOGLE_API_KEY: 'private-unit-test-key-1234567890' };
const response = () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(decision) }] } }],
  usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 30, totalTokenCount: 150 } });
const throwsCode = (fn, code) => assert.throws(fn, error => error.code === code);

test('Vertex uses only its fixed express-mode endpoint and explicit model/key/opt-in', () => {
  assert.equal(vertexConfiguration(environ).endpoint, 'https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-example:generateContent');
  for (const key of ['GOOGLE_API_KEY', 'GODIESEL_WALK_MODEL', 'GODIESEL_WALK_ALLOW_REMOTE_AGENT']) {
    throwsCode(() => vertexConfiguration({ ...environ, [key]: '' }), 'AGENT_UNCONFIGURED');
  }
  for (const model of ['https://attacker.test', '../other', 'gemini-x?key=leak', 'gemini-x/../../'])
    throwsCode(() => vertexConfiguration({ ...environ, GODIESEL_WALK_MODEL: model }), 'AGENT_MODEL');
});
test('Vertex schema preserves nullable fields, required fields, ordering and enums', () => {
  const converted = vertexSchema(schema);
  assert.deepEqual(converted.propertyOrdering, ['observation_id', 'action']);
  assert.deepEqual(converted.properties.action.properties.role, { type: 'STRING', nullable: true });
  assert.deepEqual(converted.required, schema.required);
  assert.deepEqual(converted.properties.action.properties.type.enum, ['finish']);
  assert.equal(schema.additionalProperties, false); // original is unchanged
  throwsCode(() => vertexSchema({ type: 'string', unsupported: true }), 'AGENT_PROTOCOL');
});
test('Vertex sees a PNG and observed UI, never credentials, tools or arbitrary extra input', () => {
  const body = vertexRequest({ ...input, env: environ, secret: environ.GOOGLE_API_KEY }, schema);
  assert.equal(body.contents[0].parts[1].inlineData.data, image.toString('base64'));
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.equal(body.generationConfig.maxOutputTokens, 4096);
  assert.equal(body.tools, undefined);
  assert.equal(JSON.stringify(body).includes(environ.GOOGLE_API_KEY), false);
  throwsCode(() => vertexRequest({ ...input, screenshot: Buffer.from('not a PNG') }, schema), 'AGENT_IMAGE');
});
test('Vertex usage accounts for thinking; thinking text is not the decision', () => {
  const body = response();
  body.candidates[0].content.parts.unshift({ thought: true, text: 'Not an action' });
  assert.deepEqual(parseVertexResponse(body), { decision, usage: { input_tokens: 100, output_tokens: 50 } });
});
for (const [name, mutate, code] of [
  ['refusal', b => { b.promptFeedback = { blockReason: 'SAFETY' }; }, 'AGENT_REFUSAL'],
  ['truncation', b => { b.candidates[0].finishReason = 'MAX_TOKENS'; }, 'AGENT_RESPONSE'],
  ['no candidates', b => { b.candidates = []; }, 'AGENT_RESPONSE'],
  ['invalid JSON', b => { b.candidates[0].content.parts = [{ text: 'invalid' }]; }, 'AGENT_RESPONSE'],
  ['tool call', b => { b.candidates[0].content.parts = [{ functionCall: { name: 'shell' } }]; }, 'AGENT_RESPONSE'],
  ['no usage', b => { delete b.usageMetadata; }, 'AGENT_USAGE'],
  ['undercounted thoughts', b => { b.usageMetadata.totalTokenCount = 120; }, 'AGENT_USAGE'],
  ['negative usage', b => { b.usageMetadata.promptTokenCount = -1; }, 'AGENT_USAGE'],
]) test(`Vertex blocks ${name} rather than claiming an action`, () => { const b = response(); mutate(b); throwsCode(() => parseVertexResponse(b), code); });

test('Vertex key travels only in the request header; successful HTTP is decoded once', async () => {
  let calls = 0;
  const result = await vertexDecision(input, schema, { environ, fetchImpl: async (url, init) => {
    calls++;
    assert.equal(url.includes(environ.GOOGLE_API_KEY), false);
    assert.equal(init.body.includes(environ.GOOGLE_API_KEY), false);
    assert.equal(init.headers['x-goog-api-key'], environ.GOOGLE_API_KEY);
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal instanceof AbortSignal);
    return new Response(JSON.stringify(response()));
  } });
  assert.equal(calls, 1);
  assert.deepEqual(result.decision, decision);
});
test('Vertex HTTP errors never expose response bodies, retry, or change providers', async () => {
  let calls = 0;
  await assert.rejects(vertexDecision(input, schema, { environ, fetchImpl: async () => {
    calls++; return new Response(environ.GOOGLE_API_KEY, { status: 403 });
  } }), error => error.code === 'AGENT_UNAVAILABLE' && !error.message.includes(environ.GOOGLE_API_KEY));
  assert.equal(calls, 1);
});
test('Vertex enforces response size before buffering an oversized body', async () => {
  await assert.rejects(vertexDecision(input, schema, { environ, fetchImpl: async () => new Response('x'.repeat(200001)) }),
    error => error.code === 'AGENT_RESPONSE');
});
test('provider selection is explicit, backward compatible and not inferred from a key', () => {
  assert.equal(configuredAgent(environ).id, 'vertex-gemini');
  assert.equal(liveAdapterIds.includes('injected-test-adapter'), false);
  throwsCode(() => configuredAgent({ ...environ, GODIESEL_WALK_PROVIDER: 'typo' }), 'AGENT_UNCONFIGURED');
  throwsCode(() => configuredAgent({ ...environ, GODIESEL_WALK_PROVIDER: undefined }), 'AGENT_UNCONFIGURED');
  const old = configuredAgent({ OPENAI_API_KEY: 'test-openai', GODIESEL_WALK_MODEL: 'test-model', GODIESEL_WALK_ALLOW_REMOTE_AGENT: '1' });
  assert.equal(old.id, 'openai-responses');
});
