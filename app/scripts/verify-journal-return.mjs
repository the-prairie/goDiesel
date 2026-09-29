/**
 * Journal return-path verification.
 *
 * The visible "<- Crete" link has to put the reader back where they were, and
 * it must do that without turning into an unconditional history gesture: a day
 * opened directly from a link has no history to go back to, and must still land
 * on the journal with its own route selected and visible.
 *
 * Exercises, against the real surfaces:
 *   1. the visible in-page return link (region, route, presentation, position,
 *      and no visible jump to the top followed by a correction)
 *   2. browser Back and Forward
 *   3. the Replay round trip
 *   4. a directly opened day
 *   5. scoping - one journey cannot restore into another, and nothing survives
 *      a fresh page load
 *
 * Needs a running dev or preview server and network access for the basemap.
 *
 *   npm run dev
 *   npm run verify:journal-return
 */
import { chromium } from "@playwright/test";
const BASE = process.env.BASE ?? "http://localhost:8787";
const C=encodeURIComponent('Crete, Greece'), B=encodeURIComponent('Banff/Kananaskis');
const ATLAS=`/#/lab/design-seeds/b/atlas?region=${C}&route=14130782031&theme=journal`;
const fails=[];
const check=(name,ok,detail='')=>{ console.log(`${ok?'  ok  ':' FAIL '} ${name}${detail?'  '+detail:''}`); if(!ok) fails.push(name); };

const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1440,height:760}});
const p=await ctx.newPage();
const top=()=>p.evaluate(()=>document.querySelector('[data-journal-scroller]')?.scrollTop ?? -1);
const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,140)));

/* ---- 1. visible in-page return link ---- */
console.log('\n1. visible in-page return link');
await p.goto(BASE+ATLAS,{waitUntil:'load'}); await p.waitForTimeout(6500);
const range=await p.evaluate(()=>{const n=document.querySelector('[data-journal-scroller]'); return n?n.scrollHeight-n.clientHeight:0;});
await p.locator('[data-journal-scroller]').first().hover();
await p.mouse.wheel(0,400); await p.waitForTimeout(700);
const before=await top();
check('the journal can actually be scrolled', range>60, `scrollable range ${range}px, scrolled to ${before}`);
await p.getByRole('link',{name:/Read this day/i}).click(); await p.waitForTimeout(4500);
check('day opened', p.url().includes('/story/14130782031'));
// measure any intermediate top-of-list frame during the return
await p.locator('header a').first().click();
const samples=[];
for(let i=0;i<10;i++){ samples.push(await top()); await p.waitForTimeout(60); }
await p.waitForTimeout(4500);
const after=await top();
check('visible link restored the reading position', after===before, `${before} -> ${after}`);
check('no jump to the top during the return', !samples.some(v=>v===0), `samples ${samples.join(',')}`);
const url=new URL(p.url()).hash;
check('region preserved', url.includes('region=Crete'), url.slice(0,90));
check('selected route preserved', url.includes('route=14130782031'));
check('presentation preserved', url.includes('theme=journal'));

/* ---- 2. browser Back and Forward ---- */
console.log('\n2. browser Back and Forward');
await p.getByRole('link',{name:/Read this day/i}).click(); await p.waitForTimeout(4000);
await p.goBack(); await p.waitForTimeout(4000);
check('Back restores the position', (await top())===before, `${before} -> ${await top()}`);
await p.goForward(); await p.waitForTimeout(3500);
check('Forward reaches the day again', p.url().includes('/story/14130782031'));
await p.goBack(); await p.waitForTimeout(4000);
check('Back after Forward still restores', (await top())===before);

/* ---- 3. Replay round trip ---- */
console.log('\n3. Replay round trip');
await p.getByRole('link',{name:/Read this day/i}).click(); await p.waitForTimeout(4000);
await p.getByRole('link',{name:/Fly this route/i}).click(); await p.waitForTimeout(8000);
check('replay reached', p.url().includes('#/replay/14130782031'));
const canvas=await p.evaluate(()=>{const c=document.querySelector('canvas'); return c?`${c.width}x${c.height}`:'none';});
check('replay is drawing', canvas!=='none', canvas);
await p.goBack(); await p.waitForTimeout(4000);
check('replay returns to the day', p.url().includes('/story/14130782031'));
await p.locator('header a').first().click(); await p.waitForTimeout(4500);
check('and the visible link still restores the journal', (await top())===before, `${before} -> ${await top()}`);

/* ---- 4. directly opened day ---- */
console.log('\n4. directly opened day');
const direct=await b.newContext({viewport:{width:1440,height:760}});
const dp=await direct.newPage();
await dp.goto(`${BASE}/#/lab/design-seeds/b/story/15573295095?theme=journal`,{waitUntil:'load'});
await dp.waitForTimeout(5000);
check('direct day renders', await dp.locator('h1').first().isVisible());
await dp.locator('header a').first().click(); await dp.waitForTimeout(5500);
const durl=new URL(dp.url()).hash;
check('falls back to this route’s own region', durl.includes('region=Banff'), durl.slice(0,110));
check('with the route selected', durl.includes('route=15573295095'));
check('and the presentation carried', durl.includes('theme=journal'));
const visible=await dp.evaluate(()=>{
  const row=document.querySelector('ol [aria-current="true"]'); const list=document.querySelector('[data-journal-scroller]');
  if(!row||!list) return false;
  const r=row.getBoundingClientRect(), l=list.getBoundingClientRect();
  return r.top>=l.top-1 && r.bottom<=l.bottom+1;
});
check('selected row is visible in the journal', visible);
await direct.close();

/* ---- 5. scoping: in-app moves between unrelated journeys ---- */
console.log('\n5. scoping (in-app, no reload)');
const hop = (hash) => p.evaluate((h)=>{ window.location.hash = h; }, hash);
await hop(`/lab/design-seeds/b/atlas?region=${B}&route=15573295095&theme=journal`);
await p.waitForTimeout(5000);
check('a different region starts at the top', (await top())===0, `scrollTop ${await top()}`);
await p.locator('[data-journal-scroller]').first().hover(); await p.mouse.wheel(0,120); await p.waitForTimeout(600);
const banffTop = await top();
await hop(`/lab/design-seeds/b/atlas?region=${C}&route=14130782031&theme=journal`);
await p.waitForTimeout(5000);
check('Crete still remembers its own position', (await top())===before, `${before} -> ${await top()}`);
await hop(`/lab/design-seeds/b/atlas?region=${B}&route=15573295095&theme=journal`);
await p.waitForTimeout(5000);
check('and Banff remembers its own, separately', (await top())===banffTop, `${banffTop} -> ${await top()}`);
await hop(`/lab/design-seeds/b/atlas?region=${C}&route=14130782031&theme=journal&type=cormorant`);
await p.waitForTimeout(5000);
const otherCast = await top();
const castRowVisible = await p.evaluate(()=>{
  const row=document.querySelector('ol [aria-current="true"]'); const list=document.querySelector('[data-journal-scroller]');
  if(!row||!list) return false;
  const r=row.getBoundingClientRect(), l=list.getBoundingClientRect();
  return r.top>=l.top-1 && r.bottom<=l.bottom+1;
});
check('a different presentation does not inherit the stored offset', otherCast!==before, `${before} -> ${otherCast}`);
check('and it opens with the selected row visible', castRowVisible, `scrollTop ${otherCast}`);
const reload = await b.newContext({viewport:{width:1440,height:760}});
const rp = await reload.newPage();
await rp.goto(BASE+ATLAS,{waitUntil:'load'}); await rp.waitForTimeout(5000);
check('a fresh page load starts at the top (nothing persisted off-session)',
  (await rp.evaluate(()=>document.querySelector('[data-journal-scroller]')?.scrollTop))===0);
await reload.close();

/* ---- 6. the same journey on a phone ---- */
/*
 * The narrow Atlas scrolls the whole page below the header rather than a
 * bounded list, so the reading position is stored against a different element.
 * The journey must behave identically, which is the point of storing the offset
 * per journey rather than per element.
 */
console.log('\n6. the same journey at 390x844');
const phone = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const mp = await phone.newPage();
await mp.goto(BASE+ATLAS,{waitUntil:'load'}); await mp.waitForTimeout(7000);
const mtop = () => mp.evaluate(()=>document.querySelector('[data-journal-scroller]')?.scrollTop ?? -1);
const mrange = await mp.evaluate(()=>{const n=document.querySelector('[data-journal-scroller]'); return n?n.scrollHeight-n.clientHeight:0;});
const mrows = await mp.evaluate(()=>{
  const vh=window.innerHeight;
  return [...document.querySelectorAll('ol > li')].filter(r=>{const b=r.getBoundingClientRect(); return b.top>=90 && b.bottom<=vh;}).length;
});
check('the preview can scroll away', mrange>320, `scrollable range ${mrange}px`);
await mp.locator('[data-journal-scroller]').first().hover();
await mp.mouse.wheel(0,470); await mp.waitForTimeout(900);
const mbrowsing = await mp.evaluate(()=>{
  const vh=window.innerHeight;
  const rows=[...document.querySelectorAll('ol > li')];
  const visible=rows.filter(r=>{const b=r.getBoundingClientRect(); return b.top>=90 && b.bottom<=vh;});
  return {
    count: visible.length,
    titled: visible.every(r=>{
      const t=r.querySelector('[data-journal-title]');
      return Boolean(t && t.textContent.trim().length>2 && t.getBoundingClientRect().height>0);
    }),
    titles: visible.map(r=>(r.querySelector('[data-journal-title]')?.textContent||'').trim().slice(0,26)),
  };
});
check('several complete days can be browsed', mbrowsing.count>=4, `${mrows} at rest, ${mbrowsing.count} after one scroll`);
check('and every browsed day still shows its own title', mbrowsing.titled, mbrowsing.titles.join(' | '));
const mparked = await mtop();
/* A row is a link on a phone: the day opens from the list you are browsing,
   without scrolling back up to an action that has left the screen. */
const mrow = mp.getByRole('link',{name:/holy balos batman/i}).first();
check('a journal row is a link on a phone', await mrow.count()>0);
await mrow.click(); await mp.waitForTimeout(4500);
check('tapping a row opens that day', mp.url().includes('/story/'), new URL(mp.url()).hash.slice(0,64));
await mp.locator('header a').first().click(); await mp.waitForTimeout(5000);
const murl = new URL(mp.url()).hash;
check('visible link restored the reading position on a phone', (await mtop())===mparked, `${mparked} -> ${await mtop()}`);
check('with region and presentation intact',
  murl.includes('region=Crete') && murl.includes('theme=journal'), murl.slice(0,96));
await mp.goBack(); await mp.waitForTimeout(4000);
await mp.goForward(); await mp.waitForTimeout(4500);
check('Back and Forward still work on a phone', (await mtop())===mparked, `${mparked} -> ${await mtop()}`);
await phone.close();

console.log('\npage errors:', errs.length, errs.slice(0,3));
await b.close();
console.log(fails.length? `\nFAILED: ${fails.join(' | ')}` : '\nAll return-path checks passed.');
process.exit(fails.length?1:0);
