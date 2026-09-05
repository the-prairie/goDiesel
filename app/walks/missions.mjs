import { WalkStop, assert, check, digest } from './core.mjs';
import { visible } from './browser.mjs';

export const missions = {
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
export async function libraryStory(w, query = '') {
  await w.goSurface('Routes');
  const search = w.page.getByRole('searchbox', { name: 'Search routes' });
  await search.waitFor();
  if (query) await w.action('Find the selected route in Routes', () => search.fill(query), { type: 'fill', role: 'searchbox', name: 'Search routes', value: query });
  const results = w.page.getByRole('region', { name: 'Route results' });
  const card = query ? results.getByRole('article').filter({ hasText: query }).first() : results.getByRole('article').first();
  await follow(w, card.getByRole('link').first(), 'Open the route story from its visible card');
  await w.page.getByRole('region', { name: 'Route story', exact: true }).waitFor();
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
  await libraryStory(w, title);
  const storyUrl = w.page.url();
  await w.checkpoint('The route story');
  const geography = w.page.getByRole('region', { name: 'Route geography' });
  await w.action('Read the route geography', () => geography.scrollIntoViewIfNeeded(), { type: 'scroll-to', role: 'region', name: 'Route geography' });
  await w.checkpoint('Geography and practical context');
  await w.click('link', 'Cinematic replay');
  await w.page.getByRole('link', { name: 'Route story', exact: true }).waitFor();
  await w.checkpoint('Entering Replay');
  const stage = w.page.getByTestId('replay-stage');
  await stage.waitFor();
  await w.page.waitForFunction(() => {
    const node = document.querySelector('[data-testid="replay-stage"]');
    return node && ['ready', 'unavailable', 'partial'].includes(node.getAttribute('data-state'));
  }, null, { timeout: 30000 });
  const state = await stage.getAttribute('data-state');
  if (state === 'ready') {
    const before = await w.page.getByTestId('google-route-progress').innerText();
    await w.click('button', 'Play route');
    await w.action('Watch the route move', () => w.page.waitForFunction(previous => document.querySelector('[data-testid="google-route-progress"]')?.textContent?.trim() !== previous, before.trim(), { timeout: 12000 }), { type: 'observe-motion', seconds: 12 });
    await w.checkpoint('Replay in motion');
    await w.click('button', 'Pause route');
    check(w.report, 'playback-progress', 'passed', 'Visible playback progress changed; motion frames captured. Camera aesthetics remain unreviewed.');
    // A bounded detour chosen from the current visible chapter controls, not a fixed slug.
    const chapters = w.page.getByRole('navigation', { name: 'Replay chapters' }).getByRole('button');
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
  await w.click('link', 'Route story');
  assert(w.page.url() === storyUrl, 'RETURN_CONTEXT', 'Replay did not return to the same route story.');
  await w.checkpoint('Back at the same route story');
  check(w.report, 'return-context', 'passed', 'The same route story URL was restored. Scroll position is recorded for review, not assumed.');
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
  await ({ memory, planning })[w.config.mission](w);
  check(w.report, 'mission', 'passed', `Completed ${missions[w.config.mission].title}. Other check statuses retain their own meaning.`);
}
