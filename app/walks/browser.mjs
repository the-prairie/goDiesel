import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { WalkStop, assert, check, digest, redact, addFinding } from './core.mjs';

const providers = /(?:^|\.)(?:googleapis\.com|gstatic\.com|google\.com|openfreemap\.org|cartocdn\.com|openstreetmap\.org)$/;
const destructive = /\b(?:delete|remove|publish|deploy|regenerate|save and regenerate|confirm completion|mark completed)\b/i;
// Observed in the actual Google Maps JavaScript SDK during the live acceptance
// run: a read of 3D configuration uses POST. Permit this exact provider RPC,
// not arbitrary POSTs, application writers, other hosts, ports, or RPC methods.
const googleMap3DConfig = 'https://maps.googleapis.com/$rpc/google.internal.maps.mapsjs.v1.MapsJsInternalService/GetMap3DConfig';
export function allowedRequest(url, method, target) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.username || u.password) return false;
  if (method === 'POST') return u.href === googleMap3DConfig;
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) return false;
  if (u.origin === target) return true;
  return u.protocol === 'https:' && providers.test(u.hostname);
}
export function safeInteraction(role, name) {
  return ['button', 'link', 'textbox', 'searchbox', 'combobox', 'slider', 'checkbox', 'radio'].includes(role)
    && typeof name === 'string' && name.length > 0 && name.length <= 250 && !destructive.test(name);
}
export async function visible(locator) {
  // Resolve a single visible candidate at observation time. Enumerating a live
  // collection creates unstable nested locators when repeated CTAs rerender.
  const candidate = locator.filter({ visible: true }).first();
  return await candidate.isVisible() ? candidate : null;
}
export class BrowserWalk {
  constructor(page, context, config, report, directory) {
    Object.assign(this, { page, context, config, report, directory });
    this.started = performance.now(); this.stopped = null; this.assets = []; this.pending = new Set();
  }
  async install() {
    const { context, page, config, report } = this;
    // The guard NEVER fulfills a live response. It only continues allowed reads or aborts.
    await context.route('**/*', async route => {
      const request = route.request();
      report.requests.total++;
      if (report.requests.total > config.requestBudget) {
        this.stopped ??= new WalkStop('REQUEST_BUDGET', 'The request budget was exhausted.');
        report.requests.blocked++; return route.abort().catch(() => {});
      }
      if (!allowedRequest(request.url(), request.method(), config.target)) {
        report.requests.blocked++;
        report.requests.failures.push({ kind: 'boundary', method: request.method(), url: redact(request.url()) });
        return route.abort().catch(() => {});
      }
      return route.continue().catch(() => {});
    });
    if (context.routeWebSocket) await context.routeWebSocket('**/*', socket => socket.close());
    context.on('page', popup => {
      if (popup !== page) { report.observations.push({ kind: 'boundary', detail: 'A popup was closed; it was not explored.' }); popup.close().catch(() => {}); }
    });
    page.on('dialog', dialog => dialog.dismiss().catch(() => {}));
    page.on('pageerror', error => addFinding(report, 'BROWSER_EXCEPTION', redact(error.message)));
    page.on('console', message => {
      // Console text can include provider keys. Keep only bounded, redacted observations.
      if (message.type() === 'error' && report.observations.length < 100)
        report.observations.push({ kind: 'console-error', detail: redact(message.text()) });
    });
    page.on('response', response => {
      const u = new URL(response.url());
      if (u.href === googleMap3DConfig && response.request().method() === 'POST')
        report.observations.push({ kind: 'provider-read', operation: 'google-map3d-config', status: response.status() });
      if (providers.test(u.hostname) && response.ok())
        report.requests.provider_successes[u.hostname] = (report.requests.provider_successes[u.hostname] ?? 0) + 1;
      if (response.status() >= 400 && report.requests.failures.length < 100)
        report.requests.failures.push({ kind: 'http', url: redact(response.url()), status: response.status() });
      if (u.origin === config.target && response.request().resourceType() === 'script' && this.assets.length < 12) {
        this.assets.push(u.pathname);
        const task = response.body().then(body => {
          if (body.length <= 8_000_000) report.served_build.asset_fingerprints.push({ path: u.pathname, sha256: digest(body) });
        }).catch(() => {}).finally(() => this.pending.delete(task));
        this.pending.add(task);
      }
    });
    page.on('requestfailed', request => {
      if (report.requests.failures.length < 100)
        report.requests.failures.push({ kind: 'network', url: redact(request.url()), detail: redact(request.failure()?.errorText ?? 'request failed') });
    });
  }
  budget() {
    if (this.stopped) throw this.stopped;
    if ((performance.now() - this.started) > this.config.timeBudgetSeconds * 1000)
      throw new WalkStop('TIME_BUDGET', 'The walk reached its time budget.');
    if (this.report.actions.length >= this.config.actionBudget)
      throw new WalkStop('ACTION_BUDGET', 'The walk reached its action budget.');
  }
  async action(label, fn, replay = {}) {
    this.budget();
    const start = performance.now();
    const item = { step: this.report.actions.length + 1, label: redact(label), before: redact(this.page.url()), replay, status: 'not_run' };
    this.report.actions.push(item);
    try {
      const value = await fn();
      item.status = 'passed'; item.after = redact(this.page.url());
      return value;
    } catch (error) {
      item.status = error instanceof WalkStop ? error.status : 'failed';
      item.error = redact(error.message);
      throw error;
    } finally { item.elapsed_ms = Math.round(performance.now() - start); }
  }
  async enter(hash = '') {
    assert(/^$|^#\/(?:atlas|finder|routes|admin|replay)(?:[/?].*)?$/.test(hash), 'ENTRY_PATH', 'Invalid mission entry point.');
    await this.action('Open the mission entry point', () => this.page.goto(`${this.config.target}/${hash}`, { waitUntil: 'domcontentloaded' }), { type: 'entry', hash });
    if (this.config.session === 'returning') {
      await this.page.locator('main').waitFor();
      await this.action('Return in the same isolated session', () => this.page.reload({ waitUntil: 'domcontentloaded' }), { type: 'reload' });
    }
  }
  async click(role, name, { exact = true } = {}) {
    if (!safeInteraction(role, String(name))) throw new WalkStop('UNSAFE_ACTION', 'This interaction is outside the read-only walk boundary.');
    const loc = this.page.getByRole(role, { name, exact }).filter({ visible: true });
    const item = loc.first();
    await item.waitFor({ state: 'visible' });
    if (role === 'link') {
      const href = await item.getAttribute('href');
      const url = new URL(href ?? '', this.page.url());
      if (!href || url.origin !== this.config.target || url.protocol !== new URL(this.config.target).protocol)
        throw new WalkStop('UNSAFE_ACTION', 'The link leaves the authorized app origin.');
    }
    await this.action(`Click ${name}`, () => item.click(), { type: 'click', role, name: String(name), exact });
  }
  async field(label) {
    // Native wrapping labels include option text and suffixes such as km.
    const item = this.page.getByLabel(label, { exact: false }).filter({ visible: true });
    await item.first().waitFor();
    assert(await item.count() === 1, 'AMBIGUOUS_CONTROL', 'The requested field was not uniquely visible.');
    return item;
  }
  async fill(label, value) {
    const item = await this.field(label);
    assert(await item.getAttribute('type') !== 'password', 'PASSWORD_FIELD', 'The walker must not fill credentials.');
    await this.action(`Fill ${label}`, () => item.fill(value), { type: 'fill', label, value });
  }
  async select(label, value) {
    const item = await this.field(label);
    await this.action(`Choose ${label}`, () => item.selectOption(value), { type: 'select', label, value });
  }
  async goSurface(name) {
    let link = await visible(this.page.getByRole('link', { name, exact: true }));
    if (!link) {
      await this.click('button', 'Open application navigation');
      link = await visible(this.page.getByRole('link', { name, exact: true }));
    }
    assert(link, 'NAVIGATION_MISSING', `${name} was not discoverable through navigation.`);
    await this.click('link', name);
  }
  async checkpoint(title, { final = false } = {}) {
    if (!final) this.budget();
    const index = String(this.report.checkpoints.length + 1).padStart(3, '0');
    const image = `frame-${index}.png`;
    const imageBytes = await this.page.screenshot({ path: path.join(this.directory, image), timeout: 10000 });
    const snapshot = await this.page.locator('body').ariaSnapshot();
    await writeFile(path.join(this.directory, `frame-${index}.aria.txt`), redact(snapshot, 24000), { mode: 0o600 });
    const layout = await this.page.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth }));
    this.report.checkpoints.push({ title: redact(title), image, sha256: digest(imageBytes), snapshot: `frame-${index}.aria.txt`, elapsed_ms: Math.round(performance.now() - this.started), location: redact(this.page.url()) });
    if (layout.content > layout.width + 2)
      addFinding(this.report, 'HORIZONTAL_OVERFLOW', `${layout.content}px content overflows a ${layout.width}px viewport.`);
  }
  async settleAssets() {
    await Promise.race([Promise.allSettled([...this.pending]), new Promise(resolve => setTimeout(resolve, 2000))]);
    if (this.report.served_build.asset_fingerprints.length)
      this.report.served_build.status = 'assets-observed-commit-unverified';
  }
}
