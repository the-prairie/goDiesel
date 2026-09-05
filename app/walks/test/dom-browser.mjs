/** Local-render-only fixture adapter for environments that prohibit all HTTP.
 * It does not perform, simulate success for, or bypass any network access.
 * Only navigation/rendering is emulated. Reported network observations stay empty.
 * Actual app runs and CI MUST NOT use this adapter.
 */
import { fixtureScript } from './fixture.mjs';
export async function domBrowser(target, options = {}) {
  const { chromium } = await import('playwright');
  return {
    async launch(launchOptions) {
      const browser = await chromium.launch(launchOptions);
      return new Proxy(browser, { get(object, key) {
        if (key !== 'newContext') { const value = object[key]; return typeof value === 'function' ? value.bind(object) : value; }
        return async contextOptions => {
          const context = await browser.newContext(contextOptions);
          return new Proxy(context, { get(ctx, prop) {
            if (prop !== 'newPage') { const value = ctx[prop]; return typeof value === 'function' ? value.bind(ctx) : value; }
            return async () => {
              const page = await context.newPage();
              let script = fixtureScript.replaceAll('localStorage', 'window.fixtureStorage');
              if (options.brokenReturn) script = script.replace('href="#/routes/fixture">Route story', 'href="#/routes/wrong">Route story');
              const render = async () => {
                await page.evaluate(() => { window.fixtureStorage ??= {}; window.onhashchange = null; });
                await page.setContent('<!doctype html><html lang="en"><meta charset="utf-8"><title>Local DOM fixture — NOT goDiesel</title><style>body{font:18px system-ui;margin:30px}nav a{padding:16px;display:inline-block}button,input,select{min-height:44px;margin:8px}label{display:block}section{padding:20px}</style><header>Local DOM fixture — NOT goDiesel / NO network proof</header><main></main></html>');
                await page.addScriptTag({ content: `(() => {${script.replace("addEventListener('hashchange',render);", 'window.onhashchange=render;')} })();` });
              };
              return new Proxy(page, { get(p, name) {
                if (name === 'url') return () => new URL(target).origin + '/' + new URL(page.url()).hash;
                if (name === 'goto') return async url => { await page.evaluate(hash => { location.hash = hash; }, new URL(url).hash); await render(); };
                if (name === 'reload') return render;
                const value = p[name]; return typeof value === 'function' ? value.bind(p) : value;
              } });
            };
          } });
        };
      } });
    },
  };
}
