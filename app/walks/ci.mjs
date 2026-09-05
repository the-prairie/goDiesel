/** Actual compiled-app acceptance, separate from independent harness fixtures. No publication. */
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const exec = promisify(execFile);
const target = 'http://127.0.0.1:8792/';
const server = spawn('npm', ['--prefix', 'app', 'run', 'preview', '--', '--host', '127.0.0.1', '--port', '8792', '--strictPort'], {
  cwd: root, stdio: 'ignore', detached: process.platform !== 'win32',
});
let startupError = false;
server.on('error', () => { startupError = true; });
const results = [];
try {
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (startupError || server.exitCode !== null) break;
    try { if ((await fetch(target, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch { /* bounded readiness polling */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error('PREVIEW_UNAVAILABLE');
  for (const [mission, viewport] of [['planning', 'phone'], ['library', 'desktop'], ['admin-readonly', 'phone'], ['recovery', 'desktop']]) {
    const argv = ['verify', 'app-walk', '--profile', 'controlled', '--target', target, '--mission', mission, '--viewport', viewport, '--time-budget', '120', '--seed', 'compiled-app-acceptance', '--json'];
    let stdout = '';
    try { ({ stdout } = await exec(path.join(root, 'scripts/godiesel'), argv, { cwd: root, timeout: 175000, maxBuffer: 200000 })); }
    catch (error) { stdout = error.stdout ?? ''; }
    let result;
    try { result = JSON.parse(stdout); } catch { result = { exit_code: 2, result: { status: 'blocked' }, blockers: [{ code: 'INVALID_OPERATOR_RESULT' }] }; }
    const item = { mission, viewport, status: result.result?.status ?? 'blocked', checks: [], findings: [], last_action_type: null };
    const reportPath = result.result?.report;
    if (typeof reportPath === 'string' && /^\.godiesel\/walks\/[0-9TZ.:-]+-[a-f0-9]{8}\/report\.json$/.test(reportPath)) {
      const report = JSON.parse(await readFile(path.join(root, reportPath), 'utf8'));
      // Never echo route names, coordinates, screenshots, URLs, raw errors, or traces to public logs.
      item.checks = report.checks.map(c => ({ id: /^[\w-]+$/.test(c.id) ? c.id : 'invalid', status: ['passed', 'failed', 'blocked', 'not_run'].includes(c.status) ? c.status : 'blocked' }));
      item.findings = report.findings.map(f => /^[A-Z_]+$/.test(f.code) ? f.code : 'UNCLASSIFIED');
      const type = report.actions.at(-1)?.replay?.type;
      item.last_action_type = /^[\w-]+$/.test(type ?? '') ? type : null;
    }
    results.push(item);
    console.log(JSON.stringify(item));
  }
  await writeFile(path.join(root, '.godiesel', 'compiled-app-summary.json'), JSON.stringify({ target_kind: 'local-compiled-app', provider_mode: 'controlled-build', results }, null, 2), { mode: 0o600 });
  if (results.some(r => r.status !== 'passed')) process.exitCode = 1;
} catch {
  console.error('BLOCKED: compiled app acceptance did not complete.'); process.exitCode = 2;
} finally {
  try { if (process.platform !== 'win32' && server.pid) process.kill(-server.pid, 'SIGTERM'); else server.kill(); } catch { /* process already exited */ }
}
