import { assert, check, WalkStop, digest } from './core.mjs';

export const extendedMissions = {
  explore: { title: 'Follow your curiosity', goal: 'Explore at least two product surfaces with a real purpose, take a useful detour, and leave evidence-backed observations.' },
  library: { title: 'An overlooked route', goal: 'Choose a route from the visible library, read its story, and return using browser history without losing the route.' },
  'admin-readonly': { title: 'The owner workspace, read-only', goal: 'Inspect the read-only owner workspace without changing curation.' },
  recovery: { title: 'A route request that fails once', goal: 'Recover through the visible Retry action after one explicitly controlled route-data failure.' },
  share: { title: 'A single shared route', goal: 'Inspect an already-published, explicitly selected single-route share without creating or publishing one.' },
};
export function requireControlled(config) {
  if (config.profile !== 'controlled') throw new WalkStop('FAULTS_REQUIRE_CONTROLLED', 'Fault injection is forbidden on live targets.');
}
export function chooseIndex(count, seed) {
  if (!Number.isInteger(count) || count < 1) throw new WalkStop('EMPTY_SAMPLE', 'No routes were available for this sample.');
  return Number.parseInt(digest(seed).slice(0, 8), 16) % count;
}
async function openVisibleLibraryRoute(w) {
  const cards = w.page.getByRole('region', { name: 'Route results' }).getByRole('article');
  await cards.first().waitFor({ state: 'visible' });
  const count = await cards.count();
  const index = chooseIndex(count, w.config.seed);
  const card = cards.nth(index);
  await card.scrollIntoViewIfNeeded();
  const link = card.getByRole('link').first();
  const href = await link.getAttribute('href');
  assert(href && new URL(href, w.page.url()).origin === w.config.target, 'LIBRARY_LINK', 'The sampled route link leaves the target.');
  w.report.observations.push({ kind: 'sampling', visible_candidates: count, chosen_index: index, route: href, note: 'Sampled rendered cards, not a claim of complete catalog coverage.' });
  await w.action('Open a route selected from the current library', () => link.click(), { type: 'link', href, index });
}
async function library(w) {
  await w.enter('#/routes');
  await w.checkpoint('The route library');
  // A rotating visible collection is evidence, not a duplicate lifecycle model.
  if (chooseIndex(2, w.config.seed) === 1) {
    const discovered = w.page.getByRole('button', { name: 'Discovered routes', exact: true });
    if (await discovered.count()) await w.click('button', 'Discovered routes');
  }
  await openVisibleLibraryRoute(w);
  await w.page.getByRole('region', { name: 'Route story', exact: true }).waitFor();
  const detailUrl = w.page.url();
  await w.checkpoint('A less-traveled route story');
  await w.action('Refresh this direct route entry', () => w.page.reload({ waitUntil: 'domcontentloaded' }), { type: 'reload' });
  await w.page.getByRole('region', { name: 'Route story', exact: true }).waitFor();
  assert(w.page.url() === detailUrl, 'DIRECT_ENTRY_CHANGED', 'Refresh changed the selected route identity.');
  await w.action('Return through browser history', () => w.page.goBack({ waitUntil: 'domcontentloaded' }), { type: 'back' });
  await w.page.getByRole('region', { name: 'Route results' }).waitFor();
  await w.checkpoint('Back in the collection');
  check(w.report, 'library-continuity', 'passed', 'A sampled route survived refresh and browser Back returned to the library.');
}
async function adminReadOnly(w) {
  await w.enter('#/admin');
  await w.page.getByText('Read-only mode.', { exact: false }).waitFor();
  assert(await w.page.getByLabel('Vibe', { exact: true }).isDisabled(), 'ADMIN_WRITABLE', 'The read-only workspace exposed an editable field.');
  assert(await w.page.getByRole('button', { name: 'Save and regenerate', exact: true }).count() === 0, 'ADMIN_WRITER_VISIBLE', 'A save action was visible in a read-only walk.');
  await w.checkpoint('Owner content is inspectable, not editable');
  check(w.report, 'read-only-admin', 'passed', 'The owner workspace remained read-only.');
  w.report.remaining_unproven.push('Real isolated owner-writer save and regeneration; existing curation gates remain separate');
}
async function recovery(w) {
  requireControlled(w.config);
  await w.enter('#/routes');
  let injected = 0;
  const pattern = `${w.config.target}/data/routes/*.json`;
  // Fault behavior belongs only to this explicit experiment, never a live profile.
  await w.page.route(pattern, async route => {
    if (injected === 0) {
      injected++;
      return route.fulfill({ status: 503, contentType: 'text/plain', body: 'Controlled App Walk transient failure' });
    }
    return route.fallback();
  });
  w.report.observations.push({ kind: 'controlled-fault', detail: 'The first selected route-detail request was replaced with HTTP 503. All subsequent requests use the original server.' });
  await openVisibleLibraryRoute(w);
  await w.page.getByRole('alert').waitFor();
  assert(injected === 1, 'FAULT_NOT_EXERCISED', 'The selected route did not exercise the intended controlled fault.');
  await w.checkpoint('The transient failure and its recovery action');
  await w.click('button', 'Retry');
  await w.page.getByRole('region', { name: 'Route story', exact: true }).waitFor();
  await w.checkpoint('The original route successfully retried');
  check(w.report, 'transient-route-recovery', 'passed', 'An injected one-time 503 recovered through Retry against the original server.');
}
async function share(w) {
  if (w.config.profile !== 'live' || new URL(w.config.target).hostname === 'godiesel.pages.dev')
    throw new WalkStop('SHARE_TARGET_REQUIRED', 'Select the exact already-published share origin for this read-only mission.');
  const routes = new Set();
  w.page.on('request', request => { const match = new URL(request.url()).pathname.match(/^\/data\/routes\/([^/]+)\.json$/); if (match) routes.add(match[1]); });
  await w.enter();
  await w.page.getByRole('region', { name: 'Route story', exact: true }).waitFor();
  await w.checkpoint('The one-route share');
  await w.click('link', 'Cinematic replay');
  await w.page.getByRole('link', { name: 'Route guide', exact: true }).waitFor();
  await w.checkpoint('Replay belongs to this shared guide');
  await w.click('link', 'Route guide');
  await w.page.getByRole('region', { name: 'Route story', exact: true }).waitFor();
  assert(routes.size === 1, 'SHARE_RUNTIME_SCOPE', 'The share fetched data for a different number of routes than one.');
  check(w.report, 'share-navigation', 'passed', 'Guide and Replay stayed within the selected share and fetched one route record.');
  w.report.remaining_unproven.push('Complete single-route build scoping and live imagery; runtime requests alone do not prove bundle privacy');
}
export async function runExtendedMission(w) {
  if (w.config.mission === 'explore') throw new WalkStop('AGENT_REQUIRED', 'Open-ended exploration requires the agent driver.');
  const fn = { library, 'admin-readonly': adminReadOnly, recovery, share }[w.config.mission];
  if (!fn) throw new WalkStop('UNKNOWN_MISSION', 'Unknown extended mission.');
  await fn(w);
  check(w.report, 'mission', 'passed', `Completed ${extendedMissions[w.config.mission].title}.`);
}
