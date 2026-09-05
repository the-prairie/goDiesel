/** These are harness regression probes, never evidence of live imagery or a live model. */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { visibleProgressAdvanced } from './missions.mjs';
import { fixtureScript } from './test/fixture.mjs';
import { run } from './run.mjs';

test('hidden responsive progress text cannot simulate visible movement', () => {
  const previous = globalThis.document;
  const node = { innerText: '0.00 / 100.0 km', textContent: '0.00 km0.00 / 100.0 km' };
  globalThis.document = { querySelector: () => node };
  try {
    assert.equal(visibleProgressAdvanced(0), false);
    node.textContent = '900 km';
    assert.equal(visibleProgressAdvanced(0), false);
    node.innerText = '0.01 / 100.0 km';
    assert.equal(visibleProgressAdvanced(0), true);
    node.innerText = 'Unavailable';
    assert.equal(visibleProgressAdvanced(0), false);
    assert.equal(visibleProgressAdvanced(NaN), false);
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
});

for (const broken of [false, true]) {
  test(`real HTTP harness: Replay return button ${broken ? 'rejects the wrong story' : 'completes a loaded same-story round trip'}`, async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'walk-button-regression-'));
    const destination = broken ? '#/routes/wrong' : '#/routes/fixture';
    const script = fixtureScript.replace('<a href="#/routes/fixture">Route story</a>', '<button id="story-return">Route story</button>')
      + `\ndocument.addEventListener('click', e => { if (e.target.id === 'story-return') location.hash = ${JSON.stringify(destination)}; });`;
    const server = http.createServer((req, res) => {
      res.setHeader('Content-Type', req.url === '/fixture.js' ? 'text/javascript' : 'text/html');
      res.end(req.url === '/fixture.js' ? script : '<!doctype html><html lang="en"><meta charset="utf-8"><title>Harness regression only</title><main></main><script src="/fixture.js"></script></html>');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const result = await run({ profile: 'controlled', mission: 'memory', target: `http://127.0.0.1:${server.address().port}/`, timeBudgetSeconds: 40 }, { repositoryRoot: directory });
      const report = JSON.parse(await readFile(path.join(directory, result.report), 'utf8'));
      assert.equal(report.status, broken ? 'failed' : 'passed');
      assert.ok(report.actions.some(a => a.replay.role === 'button' && a.replay.name === 'Route story'));
      if (broken) assert.ok(report.findings.some(f => f.code === 'RETURN_CONTEXT'));
      else assert.ok(report.checks.some(c => c.id === 'return-context' && c.status === 'passed'));
    } finally {
      await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
      await rm(directory, { recursive: true, force: true });
    }
  });
}
