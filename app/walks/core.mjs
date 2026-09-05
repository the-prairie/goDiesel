import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, rename, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { walkDefaults, viewports } from '../playwright.walk.config.mjs';

export class WalkStop extends Error {
  constructor(code, message, status = 'blocked') {
    super(message); this.name = 'WalkStop'; this.code = code; this.status = status;
  }
}
export const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
export const now = () => new Date().toISOString();
export const exitCode = status => ({ passed: 0, failed: 1, blocked: 2, not_run: 2 })[status] ?? 2;
export const runId = () => `${now().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
export function assert(condition, code, message) {
  if (!condition) throw new WalkStop(code, message, 'failed');
}

/** Public report text is a projection, not a copy of raw request/console data. */
export function redact(value, limit = 1500) {
  return String(value)
    .replace(/https?:\/\/[^\s<>"')]+/g, raw => {
      try { const u = new URL(raw); return `${u.origin}${u.pathname}${u.hash.split('?')[0]}`; } catch { return '[url]'; }
    })
    .replace(/\b(?:AIza[\w-]{20,}|(?:sk|ghp|github_pat)[_-][\w-]{12,})\b/g, '[secret]')
    .replace(/\b(Bearer|Basic)\s+[\w+/.=-]+/gi, '$1 [secret]')
    .replace(/\b(key|token|password|authorization|cookie|secret)\s*[:=]\s*[^\s,;]+/gi, '$1=[secret]')
    .slice(0, limit);
}
export function normalizeTarget(input, profile) {
  let u;
  try { u = new URL(input); } catch { throw new WalkStop('INVALID_TARGET', 'Provide an absolute target URL.'); }
  if (u.username || u.password || u.search || u.hash || u.pathname !== '/')
    throw new WalkStop('INVALID_TARGET', 'Target must be an origin without credentials, query, hash or path.');
  if (profile === 'controlled') {
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) || u.protocol !== 'http:')
      throw new WalkStop('INVALID_TARGET', 'Controlled walks accept only an HTTP loopback origin.');
  } else if (u.protocol !== 'https:' || u.port || !/^(?:[a-z0-9-]+\.)?godiesel\.pages\.dev$/.test(u.hostname)) {
    throw new WalkStop('INVALID_TARGET', 'Live walks accept only canonical goDiesel Pages origins over HTTPS.');
  }
  return u.origin;
}
export function configuration(input = {}) {
  const c = { ...walkDefaults, ...input };
  if (!['controlled', 'live'].includes(c.profile)) throw new WalkStop('INVALID_PROFILE', 'Choose controlled or live.');
  if (!Object.hasOwn(viewports, c.viewport)) throw new WalkStop('INVALID_VIEWPORT', 'Unknown viewport.');
  if (!['fresh', 'returning'].includes(c.session)) throw new WalkStop('INVALID_SESSION', 'Unknown session.');
  if (!['guided', 'agent'].includes(c.driver)) throw new WalkStop('INVALID_DRIVER', 'Unknown driver.');
  for (const [key, maximum] of [['actionBudget', 200], ['requestBudget', 10000], ['timeBudgetSeconds', 900]]) {
    if (!Number.isInteger(c[key]) || c[key] < 1 || c[key] > maximum)
      throw new WalkStop('INVALID_BUDGET', `${key} is outside its supported range.`);
  }
  c.target = normalizeTarget(c.target ?? (c.profile === 'controlled' ? 'http://127.0.0.1:8792/' : 'https://godiesel.pages.dev/'), c.profile);
  c.seed = String(c.seed ?? now().slice(0, 10));
  if (c.seed.length > 100) throw new WalkStop('INVALID_SEED', 'Seed is too long.');
  c.viewportSize = viewports[c.viewport];
  return c;
}

export function initialReport(config, repository) {
  return {
    schema_version: 1, document_type: 'godiesel-app-walk', id: runId(),
    started_at: now(), finished_at: null, status: 'not_run',
    mission: config.mission, profile: config.profile, driver: config.driver,
    target: config.target, repository,
    served_build: { status: 'unverified', asset_fingerprints: [] },
    browser: { version: null, viewport: config.viewportSize, device: 'emulated viewport, not a physical device', renderer: null },
    session: config.session, session_description: config.session === 'returning' ? 'Reload within a new disposable context, not an existing owner profile' : 'New disposable browser context', seed: config.seed,
    limits: { actions: config.actionBudget, requests: config.requestBudget, seconds: config.timeBudgetSeconds },
    actions: [], checkpoints: [], observations: [], findings: [],
    checks: [], requests: { total: 0, blocked: 0, provider_successes: {}, failures: [] },
    experience_review: { status: 'not_run', reason: 'Screenshots and motion require independent human or visual-agent judgment.' },
    remaining_unproven: ['Physical-device behavior', 'Subjective visual and motion quality'],
    privacy: 'Private local evidence. Screenshots may contain personal routes. Do not publish raw artifacts.',
  };
}
export function check(report, id, status, detail) {
  const entry = { id, status, detail: redact(detail) };
  const old = report.checks.findIndex(item => item.id === id);
  if (old < 0) report.checks.push(entry);
  else if (report.checks[old].status !== 'failed') report.checks[old] = entry;
}
export function addFinding(report, code, detail, { kind = 'defect', status = 'observed', step = report.actions.length } = {}) {
  const item = { code, detail: redact(detail), kind, status, step,
    fingerprint: digest([report.mission, code, kind, kind === 'opportunity' ? redact(detail) : '']).slice(0, 24) };
  if (!report.findings.some(f => f.fingerprint === item.fingerprint)) report.findings.push(item);
  return item;
}
export function finishStatus(report) {
  // A failed check cannot be made green by a later successful retry or provider block.
  if (report.checks.some(c => c.status === 'failed') || report.findings.some(f => f.kind === 'defect')) return 'failed';
  if (report.checks.some(c => c.status === 'blocked' || c.status === 'not_run')) return 'blocked';
  if (!report.checks.some(c => c.id === 'mission' && c.status === 'passed')) return 'blocked';
  return 'passed';
}
export async function privateDirectory(root, id) {
  if (!/^[\w.-]+$/.test(id)) throw new WalkStop('UNSAFE_OUTPUT', 'Invalid run directory name.');
  const base = await realpath(root);
  let cursor = base;
  for (const part of ['.godiesel', 'walks']) {
    cursor = path.join(cursor, part);
    await mkdir(cursor, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    const st = await lstat(cursor);
    if (!st.isDirectory() || st.isSymbolicLink()) throw new WalkStop('UNSAFE_OUTPUT', 'Evidence directories must not be symlinks.');
  }
  const directory = path.join(cursor, id);
  await mkdir(directory, { mode: 0o700 }); // Unique, never overwrite a previous run.
  await writeFile(path.join(directory, '.app-walk-run'), '1\n', { mode: 0o600, flag: 'wx' });
  return directory;
}
export async function atomicJSON(filename, value) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  await rename(temporary, filename);
}
export const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
export function renderReport(r) {
  const e = escapeHTML;
  const findings = r.findings.map(f => `<article><h3>${e(f.code.replaceAll('_', ' '))}</h3><p>${e(f.detail)}</p><small>${e(f.kind)} · ${e(f.status)} · action ${f.step}</small></article>`).join('') || '<p>No defects were recorded in the completed checks. This is not a claim of overall product quality.</p>';
  const frames = r.checkpoints.map(c => `<figure><img src="${e(c.image)}" alt="${e(c.title)}" loading="lazy"><figcaption>${e(c.title)} · ${e(c.elapsed_ms)} ms from start</figcaption></figure>`).join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'"><title>goDiesel App Walk</title><style>
  :root{font:16px/1.55 system-ui,sans-serif;color:#213731;background:#f5f3ed}body{max-width:1080px;margin:0 auto;padding:36px 24px}header{border-bottom:2px solid #365849;padding-bottom:24px}h1{font:2.6rem Georgia,serif;margin:.25em 0}h2{margin-top:2em}small,.muted{color:#53655d}article{border-left:3px solid #ad6540;padding:4px 20px;margin:24px 0}figure{margin:24px 0}img{width:100%;border:1px solid #bcc8be}figcaption{font-size:.9rem;margin:8px 0}table{border-collapse:collapse;width:100%}td,th{text-align:left;border-bottom:1px solid #ced5cd;padding:10px}code{overflow-wrap:anywhere}details{margin-top:32px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:.8rem} .status{font-weight:700;text-transform:uppercase;letter-spacing:.12em}@media(max-width:600px){body{padding:20px 14px}h1{font-size:2rem}}
  </style><header><div class="muted">GO DIESEL · PRODUCT FIELD NOTES</div><h1>${e(r.mission)} walk</h1><p class="status">${e(r.status)} — ${e(r.profile)} / ${e(r.driver)}</p><p>${e(r.started_at)} · ${e(r.browser.viewport.width)} × ${e(r.browser.viewport.height)}</p><p>${e(r.privacy)}</p></header><main><h2>Worth a look</h2>${findings}<h2>What was checked</h2><table><thead><tr><th>Check</th><th>Result</th><th>Evidence</th></tr></thead><tbody>${r.checks.map(c => `<tr><td>${e(c.id)}</td><td>${e(c.status)}</td><td>${e(c.detail)}</td></tr>`).join('')}</tbody></table><h2>The walk, in pictures</h2>${frames}<h2>Still unverified</h2><p>${e(r.experience_review.reason)}</p><p>${e(r.remaining_unproven.join('; '))}</p><details><summary>Engineering details and exact action history</summary><pre>${e(JSON.stringify(r, null, 2))}</pre></details></main></html>`;
}
export async function saveReport(directory, report) {
  await atomicJSON(path.join(directory, 'report.json'), report);
  await writeFile(path.join(directory, 'index.html'), renderReport(report), { mode: 0o600 });
}

export function classifyInterruption(error, browserStarted = false) {
  if (error instanceof WalkStop) return error;
  if (/ERR_BLOCKED_BY_ADMINISTRATOR|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_REFUSED|ENOTFOUND|Executable doesn't exist|browserType.launch/.test(error.message))
    return new WalkStop('ENVIRONMENT_UNAVAILABLE', 'The browser or network environment prevented this check. No product conclusion was made.');
  return new WalkStop(browserStarted ? 'JOURNEY_INTERRUPTED' : 'BROWSER_UNAVAILABLE', error.message, browserStarted ? 'failed' : 'blocked');
}
