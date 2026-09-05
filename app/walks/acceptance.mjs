/** Separate actual-app acceptance. No fixture adapter, response fulfillment, or deployment. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, lstat } from 'node:fs/promises';
import { randomBytes, createCipheriv, publicEncrypt, createHash, constants } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { liveAdapterIds } from './agents/provider.mjs';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));
const cases = {
  'controlled-memory': { profile: 'controlled', target: 'http://127.0.0.1:8792/', mission: 'memory', driver: 'guided' },
  'live-memory': { profile: 'live', target: 'https://godiesel.pages.dev/', mission: 'memory', driver: 'guided' },
  'model-planning': { profile: 'live', target: 'https://godiesel.pages.dev/', mission: 'planning', driver: 'agent' },
  'model-memory': { profile: 'live', target: 'https://godiesel.pages.dev/', mission: 'memory', driver: 'agent' },
};
const statuses = new Set(['passed', 'failed', 'blocked', 'not_run']);
const checks = new Set(['mission', 'return-context', 'named-degradation', 'playback-progress', 'hardware-renderer', 'live-provider-responses', 'plan-persistence', 'empty-search-recovery']);
const codes = new Set(['AGENT_UNCONFIGURED', 'AGENT_UNAVAILABLE', 'AGENT_RESPONSE', 'AGENT_REFUSAL', 'AGENT_PROTOCOL', 'AGENT_USAGE', 'AGENT_BUDGET', 'ENVIRONMENT_UNAVAILABLE', 'BROWSER_UNAVAILABLE', 'JOURNEY_INTERRUPTED', 'TIME_BUDGET', 'REQUEST_BUDGET', 'ACTION_BUDGET', 'BROWSER_EXCEPTION', 'HORIZONTAL_OVERFLOW', 'RETURN_CONTEXT', 'SILENT_DEGRADATION', 'UNSAFE_ACTION', 'AMBIGUOUS_CONTROL', 'EXPERIENCE_NOTE', 'NAVIGATION_MISSING']);
const operatorCodes = new Set(['GODIESEL_WALK_INCOMPLETE_RESULT', 'GODIESEL_WALK_INPUTS_CHANGED', 'GODIESEL_WALK_EVIDENCE_UNAVAILABLE', 'GODIESEL_WALK_UNSAFE_OUTPUT', 'GODIESEL_WALK_NODE_UNAVAILABLE', 'GODIESEL_WALK_CONFIGURATION']);
const count = n => Number.isSafeInteger(n) && n >= 0 && n <= 1_000_000 ? n : 0;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

export function summarize(caseName, operator, report, reportSha = null) {
  if (!Object.hasOwn(cases, caseName)) throw new Error('UNKNOWN_ACCEPTANCE_CASE');
  const config = cases[caseName];
  const renderer = report?.browser?.renderer;
  const result = {
    schema_version: 1, document_type: 'godiesel-app-walk-acceptance', case: caseName,
    profile: config.profile, mission: config.mission, driver: config.driver,
    target_kind: config.profile === 'live' ? 'deployed-canonical-app' : 'local-compiled-app',
    status: statuses.has(operator?.result?.status) ? operator.result.status : 'blocked',
    report_validated: !!report, report_sha256: report ? reportSha : null,
    checks: (report?.checks ?? []).filter(c => checks.has(c.id)).map(c => ({ id: c.id, status: statuses.has(c.status) ? c.status : 'blocked' })),
    finding_codes: [...new Set((report?.findings ?? []).map(f => codes.has(f.code) ? f.code : 'UNCLASSIFIED'))],
    operator_codes: (operator?.blockers ?? []).map(b => operatorCodes.has(b.code) ? b.code : 'UNCLASSIFIED'),
    actions: count(report?.actions?.length), frames: count(report?.checkpoints?.length),
    renderer: !renderer ? 'unavailable' : /swiftshader|llvmpipe|software|mesa offscreen/i.test(renderer) ? 'software' : 'hardware-reported',
    provider_response_count: Object.values(report?.requests?.provider_successes ?? {}).reduce((n, v) => n + count(v), 0),
    google_response_count: Object.entries(report?.requests?.provider_successes ?? {}).filter(([host]) => /(?:^|\.)(?:googleapis|gstatic|google)\.com$/.test(host)).reduce((n, [, v]) => n + count(v), 0),
    model_adapter: liveAdapterIds.includes(report?.agent?.adapter) ? report.agent.adapter : report?.agent ? 'not-a-live-adapter' : 'not_started',
    model_calls: count(report?.agent?.calls), input_tokens: count(report?.agent?.input_tokens), output_tokens: count(report?.agent?.output_tokens),
    visual_review: 'not_run', imagery_approval: 'not_established',
  };
  // Only an explicitly scoped controlled navigation/degradation check can accept
  // blocked playback. Live/model acceptance never inherits that exception.
  const passed = id => result.checks.some(c => c.id === id && c.status === 'passed');
  const controlledRoundTrip = caseName === 'controlled-memory' && result.status === 'blocked'
    && result.finding_codes.length === 0 && passed('mission') && passed('return-context') && passed('named-degradation')
    && result.checks.some(c => c.id === 'playback-progress' && c.status === 'blocked');
  result.navigation_round_trip = passed('return-context') ? 'passed' : 'not_established';
  result.model_mission = config.driver === 'agent' && passed('mission') && liveAdapterIds.includes(result.model_adapter)
    && result.model_calls > 0 && result.input_tokens > 0 && result.output_tokens > 0 ? 'passed' : 'not_established';
  result.acceptance_status = report && result.operator_codes.length === 0
    && (result.status === 'passed' || controlledRoundTrip)
    && (config.driver !== 'agent' || result.model_mission === 'passed') ? 'passed' : 'blocked';
  return result;
}

export async function executeCase(caseName, { repositoryRoot = root } = {}) {
  if (!Object.hasOwn(cases, caseName)) throw new Error('UNKNOWN_ACCEPTANCE_CASE');
  if (process.env.GODIESEL_WALK_DOM_FIXTURE) throw new Error('FIXTURE_FORBIDDEN');
  const config = cases[caseName];
  let server;
  if (config.profile === 'controlled') {
    const { spawn } = await import('node:child_process');
    server = spawn('npm', ['--prefix', 'app', 'run', 'preview', '--', '--host', '127.0.0.1', '--port', '8792', '--strictPort'], { cwd: repositoryRoot, stdio: 'ignore', detached: process.platform !== 'win32' });
    server.on('error', () => {});
  }
  try {
    if (server) {
      let ready = false;
      for (let i = 0; i < 60; i++) {
        if (server.exitCode !== null) break;
        try { if ((await fetch(config.target, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {}
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      if (!ready) throw new Error('PREVIEW_UNAVAILABLE');
    }
    const args = ['verify', 'app-walk', '--profile', config.profile, '--target', config.target,
      '--mission', config.mission, '--driver', config.driver, '--viewport', 'desktop', '--time-budget', '600',
      '--action-budget', '100', '--request-budget', '6000', '--seed', 'acceptance-followup-20260904', '--json'];
    let stdout = '', childCode = 2;
    try { ({ stdout } = await exec(path.join(repositoryRoot, 'scripts/godiesel'), args, { cwd: repositoryRoot, timeout: 660000, maxBuffer: 1_000_000 })); childCode = 0; }
    catch (error) { stdout = error.stdout ?? ''; childCode = Number.isInteger(error.code) ? error.code : 2; }
    let operator;
    try { operator = JSON.parse(stdout); } catch { operator = { result: { status: 'blocked' }, blockers: [{ code: 'INVALID_OPERATOR_RESULT' }] }; }
    // Preserve diagnostics privately even when the operator refuses the report.
    await mkdir(path.join(repositoryRoot, '.godiesel', 'acceptance'), { recursive: true, mode: 0o700 });
    await writeFile(path.join(repositoryRoot, '.godiesel', 'acceptance', `${caseName}-operator.json`), JSON.stringify({ child_exit_code: childCode, operator }, null, 2), { mode: 0o600 });
    let report = null, reportSha = null;
    const file = operator.result?.report;
    if (typeof file === 'string' && /^\.godiesel\/walks\/[0-9TZ.:-]+-[a-f0-9]{8}\/report\.json$/.test(file)) {
      for (const part of ['.godiesel', '.godiesel/walks', path.dirname(file), file]) {
        if ((await lstat(path.join(repositoryRoot, part))).isSymbolicLink()) throw new Error('LINKED_EVIDENCE');
      }
      const bytes = await readFile(path.join(repositoryRoot, file));
      const candidate = JSON.parse(bytes);
      if (candidate.document_type !== 'godiesel-app-walk' || candidate.id !== operator.result.id
        || candidate.profile !== config.profile || candidate.target !== new URL(config.target).origin
        || candidate.mission !== config.mission || candidate.driver !== config.driver
        || candidate.status !== operator.result.status || childCode !== operator.exit_code) throw new Error('EVIDENCE_MISMATCH');
      report = candidate; reportSha = sha(bytes);
    }
    const result = summarize(caseName, operator, report, reportSha);
    await writeFile(path.join(repositoryRoot, '.godiesel', 'acceptance', `${caseName}-summary.json`), JSON.stringify(result, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(result));
    return result.acceptance_status === 'passed' ? 0 : 2;
  } finally {
    if (server) try { if (process.platform !== 'win32' && server.pid) process.kill(-server.pid, 'SIGTERM'); else server.kill(); } catch {}
  }
}

// Encrypt only selected test evidence to the reviewer's public key. The private
// key never enters GitHub. Neither raw reports nor screenshots are public artifacts.
export async function sealEvidence(publicKeyFile, { repositoryRoot = root } = {}) {
  const publicKey = await readFile(publicKeyFile, 'utf8');
  const selected = [];
  for (const name of ['walks', 'evidence', 'acceptance']) {
    const entry = path.join(repositoryRoot, '.godiesel', name);
    const stat = await lstat(entry).catch(() => null);
    if (stat?.isDirectory() && !stat.isSymbolicLink()) selected.push(name);
  }
  if (!selected.length) throw new Error('NO_EVIDENCE');
  const { stdout: archive } = await exec('tar', ['-czf', '-', '-C', path.join(repositoryRoot, '.godiesel'), ...selected], { encoding: 'buffer', maxBuffer: 100_000_000, timeout: 30000 });
  const key = randomBytes(32), iv = randomBytes(12);
  const aad = Buffer.from('godiesel-private-app-walk-evidence-v1');
  const cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(archive), cipher.final()]);
  const wrapped = publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, key);
  key.fill(0);
  const output = path.join(repositoryRoot, '.godiesel', 'acceptance-export');
  await mkdir(output, { recursive: true, mode: 0o700 });
  await writeFile(path.join(output, 'evidence.enc'), ciphertext, { mode: 0o600 });
  await writeFile(path.join(output, 'encryption.json'), JSON.stringify({ version: 1, cipher: 'aes-256-gcm', wrap: 'rsa-oaep-sha256', aad: aad.toString(), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), wrapped_key: wrapped.toString('base64'), plaintext_sha256: sha(archive), ciphertext_sha256: sha(ciphertext) }, null, 2), { mode: 0o600 });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv[2] === 'seal') await sealEvidence(process.argv[3]);
    else process.exitCode = await executeCase(process.argv[2]);
  } catch {
    console.error('ACCEPTANCE_BLOCKED: see private runner evidence; no raw errors were published.');
    process.exitCode = 2;
  }
}
