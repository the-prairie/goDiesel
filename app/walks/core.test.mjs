import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, symlink, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { configuration, normalizeTarget, initialReport, finishStatus, check, renderReport, redact, privateDirectory, digest } from './core.mjs';
import { allowedRequest, safeInteraction } from './browser.mjs';

test('targets cannot exfiltrate to arbitrary, credentialed, or private live origins', () => {
  for (const target of ['https://evil.test/', 'https://godiesel.pages.dev.evil.test/', 'https://user:pass@godiesel.pages.dev/', 'http://godiesel.pages.dev/', 'https://godiesel.pages.dev/?key=secret', 'https://godiesel.pages.dev/#/admin', 'https://127.0.0.1/', 'https://godiesel.pages.dev:4430/'])
    assert.throws(() => normalizeTarget(target, 'live'));
  assert.equal(normalizeTarget('https://godiesel.pages.dev/', 'live'), 'https://godiesel.pages.dev');
  assert.equal(normalizeTarget('https://share-route.godiesel.pages.dev/', 'live'), 'https://share-route.godiesel.pages.dev');
  assert.throws(() => normalizeTarget('http://example.com/', 'controlled'));
});
test('budgets are finite, integral, positive and bounded', () => {
  for (const v of [0, -1, NaN, Infinity, 1.1, 10001]) assert.throws(() => configuration({ requestBudget: v }));
  assert.throws(() => configuration({ viewport: '../desktop' }));
});
test('failed beats blocked; incomplete and empty walks are never green', () => {
  const r = initialReport(configuration(), {});
  assert.equal(finishStatus(r), 'blocked');
  check(r, 'mission', 'passed', 'done'); assert.equal(finishStatus(r), 'passed');
  check(r, 'provider', 'blocked', 'missing'); assert.equal(finishStatus(r), 'blocked');
  check(r, 'return', 'failed', 'wrong route'); assert.equal(finishStatus(r), 'failed');
});
test('report escapes executable content and query secrets', () => {
  const r = initialReport(configuration(), {});
  r.mission = '<script>alert(1)</script>';
  const html = renderReport(r);
  assert(!html.includes('<script>')); assert(html.includes('&lt;script&gt;'));
  assert(!redact('https://a.test/path?key=123#/<safe>').includes('123'));
  assert(!redact('token=abcdef Bearer abcd.efgh').includes('abcdef'));
  assert.equal(digest(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
test('network and visible action boundary reject writers', () => {
  assert(!allowedRequest('http://127.0.0.1:8792/api/save', 'POST', 'http://127.0.0.1:8792'));
  assert(!allowedRequest('http://127.0.0.1:8766/api/admin/status', 'GET', 'http://127.0.0.1:8792'));
  assert(!allowedRequest('https://evil.test/read', 'GET', 'https://godiesel.pages.dev'));
  assert(allowedRequest('https://maps.googleapis.com/maps/api/js?key=x', 'GET', 'https://godiesel.pages.dev'));
  assert(!safeInteraction('button', 'Save and regenerate'));
  assert(safeInteraction('button', 'Save planned route'));
});
test('private output refuses symlinks, traversal and overwriting', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'walk-path-'));
  try {
    await privateDirectory(root, 'first');
    await assert.rejects(() => privateDirectory(root, 'first'));
    await assert.rejects(() => privateDirectory(root, '../outside'));
    await rm(path.join(root, '.godiesel'), { recursive: true });
    await mkdir(path.join(root, 'elsewhere'));
    await symlink(path.join(root, 'elsewhere'), path.join(root, '.godiesel'));
    await assert.rejects(() => privateDirectory(root, 'second'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a later observation cannot erase a failed check', () => {
  const r = initialReport(configuration(), {});
  check(r, 'mission', 'failed', 'original failure'); check(r, 'mission', 'passed', 'retry');
  assert.equal(finishStatus(r), 'failed'); assert.equal(r.checks[0].detail, 'original failure');
});
test('administrative network restrictions are blocked, not product defects', async () => {
  const { classifyInterruption } = await import('./core.mjs');
  const error = classifyInterruption(new Error('page.goto: net::ERR_BLOCKED_BY_ADMINISTRATOR'), true);
  assert.equal(error.status, 'blocked'); assert.equal(error.code, 'ENVIRONMENT_UNAVAILABLE');
});
