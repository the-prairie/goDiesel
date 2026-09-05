#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { configuration, initialReport, privateDirectory, saveReport, now, check, addFinding, finishStatus, WalkStop, exitCode, classifyInterruption } from './core.mjs';
import { BrowserWalk } from './browser.mjs';
import { missions, runMission } from './missions.mjs';

export const root = fileURLToPath(new URL('../../', import.meta.url));
function repositoryState() {
  try {
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    return { commit: git('rev-parse', 'HEAD'), dirty: !!git('status', '--porcelain'), kind: 'runner-checkout-not-deployed-build' };
  } catch { return { commit: null, dirty: null, kind: 'unavailable' }; }
}
export async function run(input, { chromium: suppliedChromium, repositoryRoot = root } = {}) {
  const config = configuration(input);
  if (!Object.hasOwn(missions, config.mission)) throw new WalkStop('UNKNOWN_MISSION', 'Unknown mission.');
  const report = initialReport(config, repositoryState());
  const directory = await privateDirectory(repositoryRoot, report.id);
  let browser, context, w, timer;
  try {
    if (config.driver !== 'guided') throw new WalkStop('AGENT_NOT_CONFIGURED', 'This increment supports guided walks; an agent adapter is not configured.');
    const chromium = suppliedChromium ?? (await import('playwright')).chromium;
    browser = await chromium.launch({ headless: !config.headed, ...(process.env.GODIESEL_WALK_BROWSER_PATH ? { executablePath: process.env.GODIESEL_WALK_BROWSER_PATH } : {}) });
    report.browser.version = browser.version();
    context = await browser.newContext({ viewport: config.viewportSize, serviceWorkers: 'block', acceptDownloads: false,
      ...(config.captureRaw ? { recordVideo: { dir: directory, size: config.viewportSize } } : {}) });
    if (config.captureRaw) await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
    const page = await context.newPage();
    page.setDefaultTimeout(config.actionTimeoutMs); page.setDefaultNavigationTimeout(30000);
    w = new BrowserWalk(page, context, config, report, directory);
    await w.install();
    timer = setTimeout(() => { w.stopped = new WalkStop('TIME_BUDGET', 'Walk deadline reached.'); browser.close().catch(() => {}); }, config.timeBudgetSeconds * 1000);
    report.browser.renderer = await page.evaluate(() => {
      const c = document.createElement('canvas'); const gl = c.getContext('webgl');
      if (!gl) return null;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      gl.getExtension('WEBGL_lose_context')?.loseContext(); return String(renderer);
    });
    if (config.profile === 'live') {
      const hardware = report.browser.renderer && !/swiftshader|llvmpipe|software|mesa offscreen/i.test(report.browser.renderer);
      check(report, 'hardware-renderer', hardware ? 'passed' : 'blocked', hardware ? 'A hardware renderer was reported. This is not a visual-quality judgment.' : 'No hardware-accelerated renderer was established.');
      report.remaining_unproven.push('Deployment commit identity unless independently attested');
    }
    await runMission(w);
    if (config.profile === 'live' && config.mission === 'memory') {
      const google = Object.keys(report.requests.provider_successes).some(host => /(?:googleapis|gstatic|google)\.com$/.test(host));
      check(report, 'live-provider-responses', google ? 'passed' : 'blocked', google ? 'Real Google provider responses were observed; no response was fulfilled by the walk.' : 'No successful Google provider responses were observed.');
    }
  } catch (error) {
    const stop = w?.stopped ?? classifyInterruption(error, !!browser);
    const status = stop instanceof WalkStop ? stop.status : (browser ? 'failed' : 'blocked');
    check(report, 'mission', status, stop.message);
    addFinding(report, stop.code ?? (browser ? 'JOURNEY_INTERRUPTED' : 'BROWSER_UNAVAILABLE'), stop.message, { kind: status === 'failed' ? 'defect' : 'unverified' });
    if (w && !w.page.isClosed()) await w.checkpoint('Where the walk stopped', { final: true }).catch(() => {});
  } finally {
    clearTimeout(timer);
    if (w) await w.settleAssets();
    if (config.captureRaw && context) await context.tracing.stop({ path: path.join(directory, 'trace.zip') }).catch(() => {});
    await context?.close().catch(() => {}); await browser?.close().catch(() => {});
    report.finished_at = now(); report.status = finishStatus(report);
    await saveReport(directory, report);
  }
  return { status: report.status, report: path.relative(repositoryRoot, path.join(directory, 'report.json')), html: path.relative(repositoryRoot, path.join(directory, 'index.html')), id: report.id };
}
export async function main(argv = process.argv.slice(2)) {
  try {
    const { values } = parseArgs({ args: argv, options: {
      profile: { type: 'string' }, target: { type: 'string' }, mission: { type: 'string' }, viewport: { type: 'string' }, session: { type: 'string' }, seed: { type: 'string' }, driver: { type: 'string' },
      'action-budget': { type: 'string' }, 'request-budget': { type: 'string' }, 'time-budget': { type: 'string' },
      headed: { type: 'boolean' }, 'capture-raw': { type: 'boolean' },
    } });
    const input = Object.fromEntries(Object.entries(values).map(([k, v]) => [({ 'action-budget': 'actionBudget', 'request-budget': 'requestBudget', 'time-budget': 'timeBudgetSeconds', 'capture-raw': 'captureRaw' })[k] ?? k, /-budget$/.test(k) ? Number(v) : v]));
    const result = await run(input);
    console.log(JSON.stringify(result)); return exitCode(result.status);
  } catch (error) {
    console.log(JSON.stringify({ status: 'blocked', code: error.code ?? 'WALK_START_FAILED', message: error instanceof WalkStop ? error.message : 'The walk could not start; check arguments and local configuration.' }));
    return 2;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = await main();
