/** Daily/deployment/manual driver. Read-only observations; never publishes issues or product data. */
import { readFile, writeFile, lstat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { root, eventTarget, selectMissions, publicSummary, readObservation, writeDrafts, evidenceRoot } from './operations.mjs';
import { now, atomicJSON } from './core.mjs';
const execute = promisify(execFile);

export async function automate({ environ = process.env, repository = root, child = execute } = {}) {
  const base = await evidenceRoot(repository);
  const output = path.join(base, 'public-summary.json');
  const historyFile = path.join(base, 'coverage-history.json');
  const day = now().slice(0, 10);
  let history = [], reports = [], state = 'blocked', reason = 'not-started';
  try {
    const eventText = await readFile(environ.GITHUB_EVENT_PATH, 'utf8');
    if (eventText.length > 2_000_000) throw new Error('event too large');
    const event = JSON.parse(eventText);
    const target = eventTarget(environ.GITHUB_EVENT_NAME, event, { ref: environ.GITHUB_REF });
    try {
      if ((await lstat(historyFile)).isSymbolicLink()) throw new Error('linked history');
      const raw = JSON.parse(await readFile(historyFile, 'utf8'));
      if (!Array.isArray(raw) || raw.length > 1000) throw new Error('invalid history');
      history = raw.filter(h => ['memory', 'planning', 'library', 'admin-readonly'].includes(h.mission) && /^\d{4}-\d{2}-\d{2}$/.test(h.day)).map(h => ({ day: h.day, mission: h.mission }));
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    let changedPaths = [];
    if (environ.GITHUB_EVENT_NAME === 'deployment_status') {
      try {
        const result = await child('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', event.deployment.sha], { cwd: repository, timeout: 5000, maxBuffer: 100000 });
        changedPaths = result.stdout.split('\n').filter(p => p.length < 300).slice(0, 1000);
      } catch { /* A shallow/missing deployment commit is unknown, not an invented diff. */ }
    }
    const selected = selectMissions({ day, history, changedPaths });
    for (const mission of selected) {
      const args = ['verify', 'app-walk', '--profile', 'live', '--target', target + '/', '--mission', mission,
        '--viewport', mission === 'memory' ? 'desktop' : 'phone', '--session', mission === 'memory' ? 'fresh' : 'returning',
        '--seed', day, '--time-budget', '180', '--json'];
      let stdout;
      try { ({ stdout } = await child(path.join(repository, 'scripts/godiesel'), args, { cwd: repository, timeout: 230000, maxBuffer: 200000 })); }
      catch (error) { stdout = error.stdout ?? ''; }
      let summary = { mission, profile: 'live', driver: 'guided', status: 'blocked', finding_codes: ['INVALID_OPERATOR_RESULT'] };
      try {
        const result = JSON.parse(stdout);
        const observation = await readObservation(repository, result.result.id);
        if (observation.report.target !== target || observation.report.mission !== mission || result.result.status !== observation.report.status) throw new Error('mismatched report');
        summary = publicSummary(observation.report);
        // An invalidated generic receipt cannot be promoted by the original report.
        if (result.exit_code !== ({ passed: 0, failed: 1, blocked: 2 })[summary.status] || !result.evidence) summary.status = 'blocked';
      } catch { /* Missing/malformed evidence remains a named block. */ }
      reports.push(summary);
      history.push({ day, mission });
    }
    await writeDrafts(repository);
    await atomicJSON(historyFile, history.slice(-120));
    state = reports.some(r => r.status === 'failed') ? 'failed' : reports.every(r => r.status === 'passed') ? 'passed' : 'blocked';
    reason = 'bounded-observations-completed';
  } catch { reason = 'invalid-event-environment-or-evidence'; }
  const summary = { schema_version: 1, document_type: 'godiesel-app-walk-public-batch', day, status: state, reason, reports,
    scope: 'Only the listed observed journeys. No human experience judgment or physical-device proof.',
    private_evidence: 'Not uploaded. Review the local runner evidence or run a private local walk.' };
  await atomicJSON(output, summary);
  if (environ.GITHUB_STEP_SUMMARY) {
    const lines = ['## goDiesel App Walk', '', `**${state.toUpperCase()}**`, '', ...reports.map(r => `- ${r.mission}: **${r.status}**`), '', summary.scope, '', summary.private_evidence, ''];
    await writeFile(environ.GITHUB_STEP_SUMMARY, lines.join('\n'), { flag: 'a' });
  }
  console.log(JSON.stringify(summary));
  return state === 'passed' ? 0 : state === 'failed' ? 1 : 2;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = await automate();
