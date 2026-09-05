import { WalkStop, assert, check, digest } from './core.mjs';
import { visible } from './browser.mjs';
import { extendedMissions, runExtendedMission } from './extended.mjs';

export const missions = {
  ...extendedMissions,
  memory: {
    title: 'Revisit a memory',
    goal: 'Explore Atlas, find a route story through visible navigation, experience Replay, and return to the same story.',
    questions: ['Does the next action make sense?', 'Did the route stay recognizable?', 'Did returning preserve context?'],
  },
  planning: {
    title: 'Choose the next outing',
    goal: 'Find a route-backed candidate, save a plan in this disposable session, return to it after a reload, and recover from an empty search.',
    questions: ['Is this clearly a future plan?', 'Can I find what I saved?', 'Can I recover from an unsuccessful search?'],
  },
};
async function follow(w, locator, label) {
  await locator.waitFor({ state: 'visible' });
  const href = await locator.getAttribute('href');
  assert(href && new URL(href, w.page.url()).origin === w.config.target, 'LINK_TARGET', 'The chosen link leaves the app.');
  await w.action(label, () => locator.click(), { type: 'link', href });
}
export async function libraryStory(w, query = '', slug = null) {
  await w.goSurface('Routes');
  const search = w.page.getByRole('searchbox', { name: 'Search routes' });
  await search.waitFor();
  if (query) await w.action('Find the selected route in Routes', () => search.fill(query), { type: 'fill', role: 'searchbox', name: 'Search routes', value: query });
  const results = w.page.getByRole('region', { name: 'Route results' });
  const card = query ? results.getByRole('article').filter({ hasText: query }).first() : results.getByRole('article').first();
  const link = slug ? results.locator(`a[href="#/routes/${CSSSafeSlug(slug)}"]`).first() : card.getByRole('link').first();
  await follow(w, link, 'Open the route story from its visible card');
  await w.page.getByRole('region', { name: 'Route story', exact: true }).waitFor();
}
function CSSSafeSlug(slug) {
  assert(/^[a-zA-Z0-9_-]+$/.test(slug), 'ROUTE_ID', 'The route identifier was not a safe canonical slug.');
  return slug;
}
// This function runs in the page. Use the same visible numeric value on both
// sides: textContent also includes hidden responsive labels and can pass at rest.
export function visibleProgressAdvanced(previous) {
  const text = document.querySelector('[data-testid="google-route-progress"]')?.innerText;
  const current = Number.parseFloat(text ?? '');
  return Number.isFinite(previous) && Number.isFinite(current) && current > previous;
}
export async function returnToStory(w, storyUrl) {
  await w.action('Reveal the Replay return control', () => w.page.mouse.move(w.config.viewportSize.width / 2, 24), { type: 'pointer', purpose: 'reveal-controls' });
  const button = w.page.getByRole('button', { name: 'Route story', exact: true });
  const link = w.page.getByRole('link', { name: 'Route story', exact: true });
  const controls = button.or(link).filter({ visible: true });
  await controls.first().waitFor({ state: 'visible' });
  assert(await controls.count() === 1, 'AMBIGUOUS_CONTROL', 'The Replay return control was not uniquely visible.');
  const previousHash = new URL(w.page.url()).hash;
  await w.click(await button.isVisible() ? 'button' : 'link', 'Route story');
  await w.page.waitForFunction(hash => location.hash !== hash, previousHash, { timeout: 8000 });
  assert(w.page.url() === storyUrl, 'RETURN_CONTEXT', 'Replay did not return to the same route story.');
  await w.page.getByRole('region', { name: 'Route story', exact: true }).waitFor({ state: 'visible' });
}
export async function memory(w) {
  await w.enter();
  await w.page.getByRole('main').waitFor();
  await w.checkpoint('Arriving in Atlas');
  const cards = w.page.getByRole('article');
  await cards.first().waitFor({ state: 'visible', timeout: 30000 });
  const current = w.page.locator('article[aria-current="true"]').first();
  const card = await current.count() ? current : cards.first();
  const title = (await card.getByRole('heading').first().innerText()).trim();
  const atlasLink = card.getByRole('link', { name: 'Open route' });
  const atlasDestination = await atlasLink.getAttribute('href');
  w.report.observations.push({ kind: 'navigation', detail: atlasDestination?.includes('/replay/') ? 'Atlas Open route leads directly to Replay; the story was reached through Routes.' : 'Atlas destination observed.', destination: atlasDestination });
  const selectedSlug = atlasDestination?.match(/#\/replay\/([^?]+)/)?.[1] ?? null;
  await libraryStory(w, title, selectedSlug);
  const storyUrl = w.page.url();
  const story = w.page.getByRole('region', { name: 'Route story', exact: true });
  const storyTitle = await story.getByRole('heading', { level: 1 }).innerText();
  const storySlug = new URL(storyUrl).hash.split('?')[0].split('/')[2];
  if (selectedSlug) assert(storySlug === selectedSlug, 'RETURN_CONTEXT', 'The story did not match the route selected in Atlas.');
  await w.checkpoint('The route story');
  const geography = w.page.getByRole('region', { name: 'Route geography' });
  await w.action('Read the route geography', () => geography.scrollIntoViewIfNeeded(), { type: 'scroll-to', role: 'region', name: 'Route geography' });
  await w.checkpoint('Geography and practical context');
  await w.click('link', 'Cinematic replay');
  const stage = w.page.getByTestId('replay-stage');
  await stage.waitFor();
  assert(new URL(w.page.url()).hash.split('?')[0] === `#/replay/${storySlug}`, 'RETURN_CONTEXT', 'Replay opened a different route.');
  await w.page.waitForFunction(() => {
    const node = document.querySelector('[data-testid="replay-stage"]');
    return node && ['ready', 'unavailable', 'partial'].includes(node.getAttribute('data-state'));
  }, null, { timeout: 30000 });
  await w.checkpoint('Entering Replay');
  const state = await stage.getAttribute('data-state');
  if (state === 'ready') {
    const progress = w.page.getByTestId('google-route-progress');
    const before = Number.parseFloat(await progress.innerText());
    assert(Number.isFinite(before), 'PLAYBACK_PROGRESS', 'Visible playback progress was not numeric.');
    await w.click('button', 'Play route');
    await w.action('Watch visible route distance increase', () => w.page.waitForFunction(visibleProgressAdvanced, before, { timeout: 12000 }), { type: 'observe-motion', seconds: 12 });
    await w.checkpoint('Replay in motion');
    await w.action('Observe a second motion interval', () => w.page.waitForTimeout(1200), { type: 'observe-motion', seconds: 1.2 });
    await w.checkpoint('Replay further along the route');
    await w.action('Reveal playback controls', () => w.page.mouse.move(w.config.viewportSize.width / 2, 24), { type: 'pointer', purpose: 'reveal-controls' });
    await w.click('button', 'Pause route');
    await w.page.getByRole('button', { name: 'Play route', exact: true }).waitFor();
    check(w.report, 'playback-progress', 'passed', 'Visible numeric distance increased during playback; distinct-time motion frames were captured. Imagery and camera quality require separate evidence.');
    const chapters = w.page.getByRole('navigation', { name: 'Replay chapters' }).getByRole('button').filter({ visible: true });
    const count = await chapters.count();
    if (count > 1) {
      const index = 1 + Number.parseInt(digest(w.config.seed).slice(0, 8), 16) % (count - 1);
      const name = await chapters.nth(index).getAttribute('aria-label') ?? await chapters.nth(index).innerText();
      await w.action(`Explore chapter ${name}`, () => chapters.nth(index).click(), { type: 'chapter', name, index });
      await w.checkpoint('A chapter chosen during the walk');
    }
  } else {
    const alert = await visible(w.page.getByRole('alert'));
    const statusText = alert ? await alert.innerText() : await stage.innerText();
    assert(/unavailable|could not|not available|fallback|Atlas replay/i.test(statusText), 'SILENT_DEGRADATION', 'Unavailable Replay did not explain how to proceed.');
    check(w.report, 'named-degradation', 'passed', 'Replay visibly explained that full imagery was unavailable.');
    check(w.report, 'playback-progress', 'blocked', 'Playback was not observed because the real renderer was unavailable.');
  }
  await returnToStory(w, storyUrl);
  assert(await story.getByRole('heading', { level: 1 }).innerText() === storyTitle, 'RETURN_CONTEXT', 'The returned story content did not match the original.');
  await w.checkpoint('Back at the same route story');
  check(w.report, 'return-context', 'passed', 'The Atlas-selected route, Replay route, exact return URL, and loaded story heading match. Scroll restoration is not inferred.');
}
export async function planning(w) {
  await w.enter();
  await w.goSurface('Finder');
  await w.click('button', /^(Shape the day|Edit filters)$/ , { exact: false });
  await w.fill('Place', 'Kyoto');
  await w.select('Activity', 'Run');
  await w.fill('Distance', '21');
  await w.select('Terrain', 'mixed');
  await w.fill('Vibe', 'exploratory climbing');
  await w.click('button', 'Find curated routes');
  const candidate = w.page.getByRole('article', { name: 'Kyoto, Japan candidate' });
  await candidate.waitFor();
  await w.checkpoint('A route-backed candidate');
  await w.click('button', 'Save planned route');
  await candidate.getByRole('status').filter({ hasText: 'Saved to Planned routes' }).waitFor();
  await w.action('Refresh the saved plan session', () => w.page.reload({ waitUntil: 'domcontentloaded' }), { type: 'reload' });
  await w.goSurface('Routes');
  await w.click('button', 'Planned routes');
  const planned = w.page.getByRole('article', { name: 'Planned route Kyoto' });
  await planned.waitFor();
  await follow(w, planned.getByRole('link').first(), 'Reopen the saved plan');
  await w.page.getByText('This is a plan, not a recorded activity.').waitFor();
  await w.checkpoint('The plan survived a return visit');
  check(w.report, 'plan-persistence', 'passed', 'A plan was saved and reopened after reload in this isolated browser context.');
  await w.goSurface('Finder');
  await w.click('button', /^(Shape the day|Edit filters)$/, { exact: false });
  await w.fill('Place', `walk-no-match-${digest(w.config.seed).slice(0, 8)}`);
  await w.click('button', 'Find curated routes');
  const results = w.page.getByRole('region', { name: 'Finder results' });
  await results.getByRole('status').filter({ hasText: 'No owner-curated route matches' }).waitFor();
  await w.checkpoint('An unsuccessful search that explains itself');
  await w.click('button', 'Edit search');
  await w.fill('Place', 'Kyoto');
  await w.click('button', 'Find curated routes');
  await candidate.waitFor();
  check(w.report, 'empty-search-recovery', 'passed', 'The walker recovered from an empty search through its visible Edit search action.');
}
export async function runMission(w) {
  if (!Object.hasOwn(missions, w.config.mission)) throw new WalkStop('UNKNOWN_MISSION', 'Unknown mission.');
  if (Object.hasOwn(extendedMissions, w.config.mission)) return runExtendedMission(w);
  await ({ memory, planning })[w.config.mission](w);
  check(w.report, 'mission', 'passed', `Completed ${missions[w.config.mission].title}. Other check statuses retain their own meaning.`);
}
