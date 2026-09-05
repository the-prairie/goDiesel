/** Durable practice over immutable observations. No remote writes and no automatic healing. */
import { readFile, writeFile, readdir, mkdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { digest, now, redact, WalkStop, normalizeTarget } from './core.mjs';

export const root = fileURLToPath(new URL('../../', import.meta.url));
const ids = /^[0-9TZ.:-]+-[a-f0-9]{8}$/;
const hashes = /^[a-f0-9]{64}$/;
const states = ['passed', 'failed', 'blocked', 'not_run'];
const missions = ['memory', 'planning', 'library', 'admin-readonly', 'recovery', 'share', 'explore'];
const codes = new Set(['RETURN_CONTEXT', 'HORIZONTAL_OVERFLOW', 'BROWSER_EXCEPTION', 'JOURNEY_INTERRUPTED', 'NAVIGATION_MISSING', 'CONTROL_NOT_FOUND', 'SILENT_DEGRADATION', 'LIBRARY_LINK', 'DIRECT_ENTRY_CHANGED', 'ADMIN_WRITABLE', 'ADMIN_WRITER_VISIBLE', 'FAULT_NOT_EXERCISED', 'SHARE_RUNTIME_SCOPE', 'ENVIRONMENT_UNAVAILABLE', 'BROWSER_UNAVAILABLE', 'TIME_BUDGET', 'ACTION_BUDGET', 'REQUEST_BUDGET', 'AGENT_PROTOCOL', 'AGENT_BUDGET', 'AGENT_UNCONFIGURED', 'AGENT_UNAVAILABLE', 'EXPERIENCE_NOTE']);
const plain = (value, maximum = 200) => typeof value === 'string' && value.length > 0 && value.length <= maximum;
export async function evidenceRoot(repository) {
  let current = path.resolve(repository);
  for (const part of ['.godiesel', 'walks']) {
    current = path.join(current, part);
    await mkdir(current, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new WalkStop('UNSAFE_OUTPUT', 'Evidence directories must be real directories.');
  }
  return current;
}
export async function readObservation(repository, id) {
  if (!ids.test(id)) throw new WalkStop('INVALID_RUN', 'Choose an existing walk run id.');
  const base = await evidenceRoot(repository);
  const directory = path.join(base, id);
  for (const filename of [directory, path.join(directory, '.app-walk-run'), path.join(directory, 'report.json')]) {
    const stat = await lstat(filename);
    if (stat.isSymbolicLink()) throw new WalkStop('UNSAFE_EVIDENCE', 'Linked evidence cannot be reviewed.');
  }
  const bytes = await readFile(path.join(directory, 'report.json'));
  if (bytes.length > 4_000_000) throw new WalkStop('INVALID_REPORT', 'Report exceeds its bounded contract.');
  const report = JSON.parse(bytes);
  if (report.id !== id || report.document_type !== 'godiesel-app-walk' || !states.includes(report.status) || !missions.includes(report.mission) || !Array.isArray(report.checkpoints) || !Array.isArray(report.findings))
    throw new WalkStop('INVALID_REPORT', 'Report identity or collections are invalid.');
  for (const frame of report.checkpoints) {
    if (!/^frame-\d{3}\.png$/.test(frame.image) || !hashes.test(frame.sha256)) throw new WalkStop('INVALID_FRAME', 'Invalid image reference.');
    const file = path.join(directory, frame.image);
    if ((await lstat(file)).isSymbolicLink() || digest(await readFile(file)) !== frame.sha256) throw new WalkStop('CHANGED_FRAME', 'An image changed after the observation.');
  }
  return { report, directory, sha256: digest(bytes) };
}
export async function observations(repository) {
  const base = await evidenceRoot(repository);
  const entries = (await readdir(base, { withFileTypes: true })).filter(e => e.isDirectory() && !e.isSymbolicLink() && ids.test(e.name)).sort((a, b) => a.name.localeCompare(b.name));
  if (entries.length > 1000) throw new WalkStop('ARCHIVE_REQUIRED', 'Archive reviewed evidence before reading more than 1,000 runs.');
  const values = [];
  for (const entry of entries) values.push(await readObservation(repository, entry.name));
  return values;
}

/** Public output is built from finite enumerations/counts only, never redacted free text. */
export function publicSummary(report) {
  return {
    schema_version: 1, document_type: 'godiesel-app-walk-public-summary',
    mission: missions.includes(report.mission) ? report.mission : 'unknown',
    profile: ['live', 'controlled'].includes(report.profile) ? report.profile : 'unknown',
    driver: ['guided', 'agent'].includes(report.driver) ? report.driver : 'unknown',
    status: states.includes(report.status) ? report.status : 'blocked',
    action_count: Array.isArray(report.actions) ? Math.min(report.actions.length, 200) : 0,
    frame_count: Array.isArray(report.checkpoints) ? Math.min(report.checkpoints.length, 201) : 0,
    finding_codes: [...new Set((Array.isArray(report.findings) ? report.findings : []).map(f => codes.has(f.code) ? f.code : 'UNCLASSIFIED'))],
    review_status: 'not_run',
  };
}
export function ledger(records) {
  const groups = new Map();
  for (const { report, sha256 } of records) {
    for (const finding of report.findings.filter(f => ['defect', 'opportunity'].includes(f.kind))) {
      const viewport = report.browser?.viewport ?? {};
      const key = digest([report.mission, report.profile, report.target, viewport.width, viewport.height, finding.code, finding.kind,
        finding.kind === 'opportunity' ? redact(finding.detail) : '']);
      if (!groups.has(key)) groups.set(key, { id: key, mission: report.mission, kind: finding.kind, code: finding.code,
        title: `${report.mission}: ${codes.has(finding.code) ? finding.code.replaceAll('_', ' ').toLowerCase() : 'observation needs review'}`,
        state: 'needs-review', detail: redact(finding.detail), occurrences: [], resolution: 'not established' });
      const item = groups.get(key);
      if (!item.occurrences.some(o => o.run_id === report.id)) item.occurrences.push({ run_id: report.id, report_sha256: sha256, step: finding.step });
    }
  }
  // A later unrelated pass never closes an earlier problem. Repetition is not independent reproduction.
  return { schema_version: 1, document_type: 'godiesel-app-walk-issue-drafts', privacy: 'private; review before external publication',
    issues: [...groups.values()].map(item => ({ ...item, recurrence: item.occurrences.length > 1 ? 'repeated-observation' : 'single-observation' })) };
}
export async function writeDrafts(repository) {
  const records = await observations(repository);
  const value = ledger(records);
  const base = await evidenceRoot(repository);
  const filename = path.join(base, `drafts-${digest(value).slice(0, 24)}.json`);
  // Content-addressed draft snapshots never overwrite their inputs or silently resolve anything.
  await writeFile(filename, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }).catch(async error => {
    if (error.code !== 'EEXIST' || (await lstat(filename)).isSymbolicLink()) throw error;
    if ((await readFile(filename, 'utf8')) !== JSON.stringify(value, null, 2) + '\n') throw new WalkStop('CHANGED_DRAFT', 'Existing draft does not match its identity.');
  });
  return { status: 'passed', draft: path.relative(repository, filename), issues: value.issues.length };
}
export function validateReview(input, observation) {
  const required = ['report_sha256', 'reviewer', 'kind', 'judgment', 'frames', 'notes'];
  if (!input || Object.keys(input).length !== required.length || !required.every(k => Object.hasOwn(input, k))) throw new WalkStop('INVALID_REVIEW', 'Review fields do not match the closed contract.');
  if (input.report_sha256 !== observation.sha256 || !plain(input.reviewer, 100) || !['human', 'visual-agent'].includes(input.kind)
      || !['coherent', 'needs-attention', 'unverified'].includes(input.judgment) || !plain(input.notes, 4000)
      || !Array.isArray(input.frames) || input.frames.length < 1 || new Set(input.frames).size !== input.frames.length
      || input.frames.some(name => !observation.report.checkpoints.some(f => f.image === name)))
    throw new WalkStop('INVALID_REVIEW', 'Review must identify this exact report, a reviewer, and existing images.');
  return { ...input, reviewer: redact(input.reviewer), notes: redact(input.notes, 4000) };
}
export async function recordReview(repository, id, input) {
  const observation = await readObservation(repository, id);
  const review = validateReview(input, observation);
  const document = { schema_version: 1, document_type: 'godiesel-app-walk-review', run_id: id, recorded_at: now(), ...review,
    machine_status: observation.report.status, authority: 'attributed judgment, not independently authenticated identity',
    scope: 'Cited still images only; this does not attest motion, providers, physical devices, or a fixed defect.' };
  const filename = path.join(observation.directory, `review-${digest(document).slice(0, 24)}.json`);
  await writeFile(filename, JSON.stringify(document, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return { status: 'passed', review: path.relative(repository, filename), machine_status: observation.report.status };
}
export function selectMissions({ day = now().slice(0, 10), history = [], changedPaths = [] } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day))) throw new WalkStop('INVALID_DAY', 'Use an ISO calendar date.');
  const choices = ['planning', 'library', 'admin-readonly'];
  const rotated = [...choices.slice(Number.parseInt(digest(day).slice(0, 4), 16) % 3), ...choices.slice(0, Number.parseInt(digest(day).slice(0, 4), 16) % 3)];
  const score = mission => {
    const relevant = changedPaths.some(p => typeof p === 'string' && (mission === 'planning' ? /surfaces\/finder\//.test(p) : mission === 'admin-readonly' ? /surfaces\/admin\//.test(p) : /surfaces\/routes\//.test(p)));
    const last = history.filter(h => h.mission === mission && /^\d{4}-\d{2}-\d{2}$/.test(h.day) && h.day <= day).map(h => h.day).sort().at(-1);
    const age = last ? Math.min(14, Math.max(0, (Date.parse(day) - Date.parse(last)) / 86400000)) : 15;
    return age + (relevant ? 4 : 0);
  };
  rotated.sort((a, b) => score(b) - score(a));
  return ['memory', rotated[0]];
}
export function eventTarget(eventName, event, { ref = 'refs/heads/main' } = {}) {
  if (event.repository?.full_name !== 'the-prairie/goDiesel' || event.repository?.default_branch !== 'main') throw new WalkStop('UNTRUSTED_EVENT', 'Only this repository and its trusted main branch may schedule a walk.');
  if (eventName === 'schedule') {
    if (ref !== 'refs/heads/main') throw new WalkStop('UNTRUSTED_REF', 'Scheduled walks execute main only.');
    return 'https://godiesel.pages.dev';
  }
  if (eventName === 'workflow_dispatch') {
    if (ref !== 'refs/heads/main') throw new WalkStop('UNTRUSTED_REF', 'Manual recurring walks execute main, not an arbitrary branch.');
    return normalizeTarget(event.inputs?.target ?? 'https://godiesel.pages.dev/', 'live');
  }
  if (eventName === 'deployment_status') {
    if (event.deployment_status?.state !== 'success' || !/^[a-f0-9]{40}$/.test(event.deployment?.sha ?? '')
        || !['main', 'production'].includes(event.deployment?.ref)) throw new WalkStop('UNTRUSTED_DEPLOYMENT', 'Only successful main/production deployments are eligible.');
    return normalizeTarget(event.deployment_status.environment_url, 'live');
  }
  throw new WalkStop('UNSUPPORTED_EVENT', 'This event cannot start a recurring walk.');
}

export async function main(argv = process.argv.slice(2)) {
  try {
    const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { run: { type: 'string' }, input: { type: 'string' } } });
    let result;
    if (positionals.length !== 1) throw new WalkStop('INVALID_COMMAND', 'Choose drafts, inspect-review, or review.');
    if (positionals[0] === 'drafts') result = await writeDrafts(root);
    else if (positionals[0] === 'inspect-review') {
      const observation = await readObservation(root, values.run);
      result = { run_id: observation.report.id, report_sha256: observation.sha256, frames: observation.report.checkpoints.map(f => f.image), machine_status: observation.report.status };
    } else if (positionals[0] === 'review') {
      const text = await readFile(values.input, 'utf8');
      if (text.length > 8000) throw new WalkStop('INVALID_REVIEW', 'Review input is too large.');
      result = await recordReview(root, values.run, JSON.parse(text));
    } else throw new WalkStop('INVALID_COMMAND', 'Unknown operation.');
    console.log(JSON.stringify(result)); return 0;
  } catch (error) {
    console.log(JSON.stringify({ status: 'blocked', code: error instanceof WalkStop ? error.code : 'INVALID_INPUT' })); return 2;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = await main();
