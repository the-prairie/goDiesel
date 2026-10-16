import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../../../', import.meta.url);
const initialRoutes = [
  { activity_id: 'synthetic-one', name: 'Synthetic river run', type: 'Run', distance_km: 8, date: '2026-01-01', status: 'pending', region: '', auto_region: 'Test valley', title: '', description: '' },
  { activity_id: 'synthetic-two', name: 'Synthetic hill ride', type: 'Ride', distance_km: 22, date: '2026-01-02', status: 'approved', region: 'Test hills', auto_region: 'Test hills', title: '', description: '' },
];

export async function startStandaloneAdminFixture(port = 0) {
  let routes = structuredClone(initialRoutes);
  let classification = { running: false, total: 0, done: 0, updated: 0, unmapped: 1 };
  let mutations = {};
  let classifierOptions = {};
  const pendingStarts = [];
  const pendingSaves = [];
  const calls = { saves: [], rebuilds: 0, starts: 0, polls: 0, routeReads: 0 };
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    const send = (body, type = 'application/json', status = 200) => {
      response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      response.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
    };
    let body = '';
    for await (const chunk of request) body += chunk;
    if (path === '/fixture/reset') {
      routes = structuredClone(initialRoutes);
      mutations = {};
      classifierOptions = {};
      pendingStarts.splice(0).forEach(resolve => resolve());
      pendingSaves.splice(0).forEach(resolve => resolve());
      classification = { running: false, total: 0, done: 0, updated: 0, unmapped: 1, ...JSON.parse(body || '{}') };
      calls.saves = []; calls.rebuilds = 0; calls.starts = 0; calls.polls = 0; calls.routeReads = 0;
      return send({ ok: true });
    }
    if (path === '/fixture/classifier-options') { classifierOptions = JSON.parse(body); return send({ ok: true }); }
    if (path === '/fixture/release-starts') { classifierOptions.holdStarts = false; pendingStarts.splice(0).forEach(resolve => resolve()); return send({ ok: true }); }
    if (path === '/fixture/mutations') { mutations = JSON.parse(body); return send({ ok: true }); }
    if (path === '/fixture/release-saves') { mutations.holdSaves = false; pendingSaves.splice(0).forEach(resolve => resolve()); return send({ ok: true }); }
    if (path === '/fixture/classification') { classification = JSON.parse(body); return send({ ok: true }); }
    if (path === '/fixture/calls') return send(calls);
    if (path === '/api/routes') { calls.routeReads++; return send(routes); }
    if (path.startsWith('/api/polyline/')) return send('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><path d="M5 40L30 10L70 35L95 5" stroke="#00F19F" fill="none"/></svg>', 'image/svg+xml');
    if (path === '/api/save') {
      const updates = JSON.parse(body).routes;
      calls.saves.push(updates);
      if (mutations.holdSaves) await new Promise(resolve => pendingSaves.push(resolve));
      routes = routes.map(route => ({ ...route, ...updates.find(update => update.activity_id === route.activity_id) }));
      return send({ ok: true, updated: updates.length });
    }
    if (path === '/api/rebuild') { calls.rebuilds++; return send({ ok: !mutations.rebuildStatus }, 'application/json', mutations.rebuildStatus || 200); }
    if (path === '/api/auto-classify') {
      calls.starts++;
      if (classifierOptions.holdStarts) await new Promise(resolve => pendingStarts.push(resolve));
      if (classifierOptions.startStatus) return send({ error: 'Classification unavailable' }, 'application/json', classifierOptions.startStatus);
      classification = { running: true, total: 2, done: 1, updated: 1, unmapped: 1, last_label: 'Test valley' };
      return send({ ok: true });
    }
    if (path === '/api/classify-status') {
      calls.polls++;
      if (classifierOptions.pollDelay) await new Promise(resolve => setTimeout(resolve, classifierOptions.pollDelay));
      if (classifierOptions.pollStatus) return send({ error: 'Check unavailable' }, 'application/json', classifierOptions.pollStatus);
      return send(classification);
    }
    const assets = { '/admin-assets/classifier-state.js': 'admin-ui/generated/classifier-state.js', '/admin-assets/mutation-state.js': 'admin-ui/generated/mutation-state.js', '/': 'admin.html', '/admin.html': 'admin.html', '/admin-assets/presentation.js': 'admin-ui/generated/presentation.js' };
    if (assets[path]) {
      try { return send(await readFile(new URL(assets[path], root)), path.endsWith('.js') ? 'text/javascript' : 'text/html'); }
      catch { return send({ error: 'missing fixture asset' }, 'application/json', 404); }
    }
    send({ error: 'not found' }, 'application/json', 404);
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const fixture = await startStandaloneAdminFixture(Number(process.argv[2] || 8828));
  console.log(`Synthetic standalone admin at ${fixture.url}`);
}
