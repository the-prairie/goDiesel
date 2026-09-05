import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { digest, privateDirectory, atomicJSON } from './core.mjs';
import { publicSummary, ledger, readObservation, writeDrafts, recordReview, validateReview, selectMissions, eventTarget } from './operations.mjs';
import { automate } from './automate.mjs';

const trusted = { repository: { full_name: 'the-prairie/goDiesel', default_branch: 'main' } };
async function sample(root, n = 1, overrides = {}) {
  const id = `2026-09-04T12-00-00-000Z-${String(n).padStart(8, '0')}`;
  const directory = await privateDirectory(root, id);
  const bytes = Buffer.from('explicit fixture image; not product evidence');
  await writeFile(path.join(directory, 'frame-001.png'), bytes);
  const report = { id, schema_version: 1, document_type: 'godiesel-app-walk', status: 'failed', mission: 'memory', profile: 'live', driver: 'guided', target: 'https://godiesel.pages.dev', browser: { viewport: { width: 1440, height: 900 } },
    actions: [{ step: 1, label: 'private route name' }], checkpoints: [{ image: 'frame-001.png', sha256: digest(bytes) }],
    findings: [{ kind: 'defect', code: 'RETURN_CONTEXT', step: 1, detail: 'private owner route note' }], ...overrides };
  await atomicJSON(path.join(directory, 'report.json'), report);
  return readObservation(root, id);
}
async function temporary(fn) { const root = await mkdtemp(path.join(tmpdir(), 'walk-ops-')); try { return await fn(root); } finally { await rm(root, { recursive: true, force: true }); } }
const reviewFor = observation => ({ report_sha256: observation.sha256, reviewer: 'Test reviewer', kind: 'human', judgment: 'needs-attention', frames: ['frame-001.png'], notes: 'A fixture-only review, not product approval.' });

test('public summary cannot leak free text, route identifiers, keys, URLs or injected markup', () => {
  const secret = 'secret-route-token-very-private';
  const value = publicSummary({ mission: secret, profile: secret, driver: secret, status: secret, target: `https://x/?key=${secret}`, actions: [{ label: secret }], checkpoints: [{ title: secret }], findings: [{ code: secret, detail: secret }, { code: 'RETURN_CONTEXT', detail: secret }], reviewer: secret });
  assert(!JSON.stringify(value).includes(secret));
  assert.equal(value.status, 'blocked'); assert.equal(value.review_status, 'not_run');
  assert.deepEqual(value.finding_codes, ['UNCLASSIFIED', 'RETURN_CONTEXT']);
});
test('deduplication retains context and never mistakes recurrence or an unrelated pass for resolution', () => {
  const base = { report: { id: 'first', mission: 'memory', profile: 'live', target: 'https://a', browser: { viewport: { width: 390, height: 844 } }, findings: [{ kind: 'defect', code: 'RETURN_CONTEXT', detail: 'same defect', step: 2 }] }, sha256: 'a' };
  const second = { report: { ...base.report, id: 'second' }, sha256: 'b' };
  const passed = { report: { ...base.report, id: 'later-pass', status: 'passed', findings: [] }, sha256: 'c' };
  const another = { report: { ...base.report, id: 'desktop', browser: { viewport: { width: 1440, height: 900 } } }, sha256: 'd' };
  const result = ledger([base, second, passed, another, base]);
  assert.equal(result.issues.length, 2);
  assert.equal(result.issues[0].occurrences.length, 2);
  assert.equal(result.issues[0].recurrence, 'repeated-observation');
  assert.equal(result.issues[0].state, 'needs-review');
  assert.equal(result.issues[0].resolution, 'not established');
});
test('draft snapshots are idempotent, private and do not change original evidence', () => temporary(async root => {
  const original = await sample(root);
  const a = await writeDrafts(root), b = await writeDrafts(root);
  assert.deepEqual(a, b); assert.equal(a.issues, 1);
  assert.equal((await readObservation(root, original.report.id)).sha256, original.sha256);
}));
test('a visual review is an immutable separate judgment, not a green machine result', () => temporary(async root => {
  const observation = await sample(root);
  const result = await recordReview(root, observation.report.id, reviewFor(observation));
  assert.equal(result.machine_status, 'failed');
  assert.equal((await readObservation(root, observation.report.id)).sha256, observation.sha256);
  const stored = JSON.parse(await readFile(path.join(root, result.review), 'utf8'));
  assert.equal(stored.judgment, 'needs-attention'); assert.match(stored.scope, /still images only/);
}));
for (const [name, mutate] of Object.entries({
  stale: x => ({ ...x, report_sha256: '0'.repeat(64) }),
  forgedFrame: x => ({ ...x, frames: ['../../outside.png'] }),
  emptyFrames: x => ({ ...x, frames: [] }),
  duplicateFrames: x => ({ ...x, frames: ['frame-001.png', 'frame-001.png'] }),
  extraAuthority: x => ({ ...x, approved_for_release: true }),
  missingReviewer: x => ({ ...x, reviewer: '' }),
})) test(`review rejects ${name}`, () => temporary(async root => {
  const observation = await sample(root);
  assert.throws(() => validateReview(mutate(reviewFor(observation)), observation));
}));
test('changed images and linked evidence cannot acquire reviews', () => temporary(async root => {
  const observation = await sample(root);
  await writeFile(path.join(observation.directory, 'frame-001.png'), 'changed');
  await assert.rejects(() => readObservation(root, observation.report.id));
  await assert.rejects(() => readObservation(root, '../elsewhere'));
  await rm(path.join(root, '.godiesel'), { recursive: true });
  const outside = path.join(root, 'outside'); await mkdir(outside);
  await symlink(outside, path.join(root, '.godiesel'));
  await assert.rejects(() => readObservation(root, observation.report.id));
}));
test('scheduling balances recency and changed surfaces, retaining the flagship mission', () => {
  const day = '2026-09-04';
  const history = ['planning', 'library', 'admin-readonly'].map(mission => ({ mission, day }));
  const impacted = selectMissions({ day, history, changedPaths: ['app/src/surfaces/admin/admin-page.tsx'] });
  assert.deepEqual(impacted, ['memory', 'admin-readonly']);
  assert.deepEqual(selectMissions({ day }), selectMissions({ day }));
  assert.deepEqual(selectMissions({ day, history: history.slice(0, 2) }), ['memory', 'admin-readonly']);
  assert.throws(() => selectMissions({ day: 'not-a-date' }));
});
test('event targets are resolved only from trusted successful deployment events', () => {
  assert.equal(eventTarget('schedule', trusted), 'https://godiesel.pages.dev');
  assert.equal(eventTarget('workflow_dispatch', { ...trusted, inputs: { target: 'https://preview.godiesel.pages.dev/' } }), 'https://preview.godiesel.pages.dev');
  const deployed = { ...trusted, deployment: { sha: 'a'.repeat(40), ref: 'production' }, deployment_status: { state: 'success', environment_url: 'https://godiesel.pages.dev/' } };
  assert.equal(eventTarget('deployment_status', deployed), 'https://godiesel.pages.dev');
  for (const event of [ { ...deployed, deployment_status: { ...deployed.deployment_status, state: 'failure' } }, { ...deployed, deployment: { ...deployed.deployment, ref: 'attacker-branch' } }, { ...deployed, deployment: { ...deployed.deployment, sha: 'shell;injection' } }, { ...deployed, deployment_status: { ...deployed.deployment_status, environment_url: 'https://godiesel.pages.dev.evil.test/' } } ]) assert.throws(() => eventTarget('deployment_status', event));
  assert.throws(() => eventTarget('pull_request_target', trusted));
  assert.throws(() => eventTarget('schedule', trusted, { ref: 'refs/heads/untrusted' }));
  assert.throws(() => eventTarget('workflow_dispatch', trusted, { ref: 'refs/heads/untrusted' }));
  assert.throws(() => eventTarget('schedule', { repository: { ...trusted.repository, full_name: 'attacker/fork' } }));
});
for (const state of ['passed', 'failed', 'blocked']) test(`recurring loop preserves ${state}, writes only finite public fields and still visits both missions`, () => temporary(async root => {
  const eventPath = path.join(root, 'event.json'); await writeFile(eventPath, JSON.stringify(trusted));
  let calls = 0;
  const child = async (file, args) => {
    assert.match(file, /scripts\/godiesel$/); assert.equal(args[0], 'verify');
    const mission = args[args.indexOf('--mission') + 1];
    const observation = await sample(root, ++calls, { status: state, mission, findings: state === 'failed' ? [{ code: 'RETURN_CONTEXT', kind: 'defect', detail: 'PRIVATE_SECRET_DO_NOT_UPLOAD', step: 1 }] : [] });
    const result = { exit_code: ({ passed: 0, failed: 1, blocked: 2 })[state], evidence: { path: 'fixture-receipt' }, result: { id: observation.report.id, status: state } };
    return { stdout: JSON.stringify(result) };
  };
  const code = await automate({ repository: root, child, environ: { GITHUB_EVENT_PATH: eventPath, GITHUB_EVENT_NAME: 'schedule', GITHUB_REF: 'refs/heads/main' } });
  assert.equal(calls, 2); assert.equal(code, ({ passed: 0, failed: 1, blocked: 2 })[state]);
  const text = await readFile(path.join(root, '.godiesel/walks/public-summary.json'), 'utf8');
  assert(!text.includes('PRIVATE_SECRET')); assert(!text.includes('https://')); assert(!text.includes('private route name'));
  const history = JSON.parse(await readFile(path.join(root, '.godiesel/walks/coverage-history.json'), 'utf8'));
  assert.equal(history.length, 2); assert(history.every(x => Object.keys(x).length === 2));
}));
test('untrusted events cannot launch a browser and get a blocked public summary', () => temporary(async root => {
  const eventPath = path.join(root, 'event.json'); await writeFile(eventPath, JSON.stringify(trusted));
  const code = await automate({ repository: root, child: () => assert.fail('must not invoke'), environ: { GITHUB_EVENT_PATH: eventPath, GITHUB_EVENT_NAME: 'pull_request_target' } });
  assert.equal(code, 2);
}));
test('workflow cannot upload raw routes/screenshots, mutate issues or check out event-controlled code', async () => {
  const workflow = await readFile(new URL('../../.github/workflows/app-walk.yml', import.meta.url), 'utf8').catch(() => readFile(new URL('../../../.github/workflows/app-walk.yml', import.meta.url), 'utf8'));
  assert.match(workflow, /contents: read/); assert.match(workflow, /ref: main/); assert.match(workflow, /persist-credentials: false/);
  assert(!/issues:\s*write|pull_request_target|secrets\./.test(workflow));
  const upload = workflow.split('uses: actions/upload-artifact@v4')[1];
  assert.match(upload, /path: \.godiesel\/walks\/public-summary\.json/); assert(!/trace|\.png|\*\*/.test(upload));
});
