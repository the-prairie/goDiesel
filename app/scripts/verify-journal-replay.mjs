/**
 * Replay continuity verification for the journal presentation.
 *
 * Replay is the real product surface, entered from the day and returned from by
 * its own visible link. This proves the round trip end to end rather than
 * asserting a canvas exists:
 *
 *   - playback actually advances, and monotonically, read from the product's
 *     own progress readout rather than from internal state
 *   - pause holds
 *   - the route carries the journal's terracotta identity onto the dark
 *     surface instead of the shared cobalt default
 *   - the return happens through the visible links only - Replay's back link
 *     to the day, the day's back link to the journal - with region, selected
 *     route and reading position intact
 *
 * The Replay canvas does not keep its drawing buffer, so pixels are read from a
 * screenshot rather than `drawImage`, which returns a cleared buffer there.
 *
 * Which renderer this proves is an input, not an accident. The day's "Fly this
 * route" link opens Google photorealistic 3D when the build has a Google key
 * and the MapLibre Atlas replay when it does not, so the same journey reaches
 * different renderers on different machines. EXPECT_RENDERER names the one
 * this run must prove; if the visible link opens another, the run fails and
 * says why instead of quietly proving something else.
 *
 *   EXPECT_RENDERER=atlas  (default) the journal baseline: MapLibre Atlas
 *                          replay, journal HUD and terracotta thread. Serve with
 *                          live providers off: GODIESEL_DISABLE_LIVE_PROVIDERS=1
 *   EXPECT_RENDERER=google Google 3D Story Flight with the journal cast. Needs a
 *                          Google key; uses live imagery.
 *
 *   GODIESEL_DISABLE_LIVE_PROVIDERS=1 npm run dev -- --port 8792
 *   BASE=http://localhost:8792 npm run verify:journal-replay
 */
import { chromium } from "@playwright/test";
import fs from 'node:fs';
import { PNG } from "pngjs";
const BASE = process.env.BASE ?? "http://localhost:8787";
const EXPECT_RENDERER = process.env.EXPECT_RENDERER ?? "atlas";
const ENGINE = { atlas: "maplibre-atlas", google: "google-3d-maps" };
if (!ENGINE[EXPECT_RENDERER]) throw new Error(`EXPECT_RENDERER must be atlas or google, not ${EXPECT_RENDERER}`);
const DIR = process.env.OUT ?? "test-results/journal-replay";
fs.mkdirSync(DIR,{recursive:true});
const C=encodeURIComponent('Crete, Greece');
const ATLAS=`/#/lab/design-seeds/b/atlas?region=${C}&route=14130782031&theme=journal`;
const fails=[];
const check=(n,ok,d='')=>{ console.log(`${ok?'  ok  ':' FAIL '} ${n}${d?'  '+d:''}`); if(!ok) fails.push(n); };
const b=await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const proven = [];
console.log(`expecting the ${EXPECT_RENDERER} renderer (${ENGINE[EXPECT_RENDERER]})`);
for (const vp of [{width:1440,height:800,name:'desktop'},{width:390,height:844,name:'mobile'}]) {
  console.log(`\n=== ${vp.name} ${vp.width}x${vp.height}`);
  const ctx=await b.newContext({viewport:{width:vp.width,height:vp.height},isMobile:vp.name==='mobile',hasTouch:vp.name==='mobile'});
  const p=await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,140)));
  await p.goto(BASE+ATLAS,{waitUntil:'load'}); await p.waitForTimeout(7000);
  const list=p.locator('[data-journal-scroller]').first();
  await list.hover().catch(()=>{});
  await p.mouse.wheel(0,400); await p.waitForTimeout(700);
  const parked=await p.evaluate(()=>document.querySelector('[data-journal-scroller]')?.scrollTop);
  await p.getByRole('link',{name:/Read this day/i}).click(); await p.waitForTimeout(4500);
  await p.getByRole('link',{name:/Fly this route/i}).click(); await p.waitForTimeout(9000);
  check('replay reached', p.url().includes('#/replay/'), new URL(p.url()).hash.slice(0,60));
  const stage = p.getByTestId('replay-stage');
  const engine = await stage.getAttribute('data-engine').catch(()=>null);
  const state = await stage.getAttribute('data-state').catch(()=>null);
  proven.push({ viewport: vp.name, expected: ENGINE[EXPECT_RENDERER], engine, state, link: new URL(p.url()).hash.slice(0,90) });
  if (engine !== ENGINE[EXPECT_RENDERER]) {
    check('the visible link opened the expected renderer', false,
      `opened ${engine}; expected ${ENGINE[EXPECT_RENDERER]}. The link follows the build's Google key: ` +
      (EXPECT_RENDERER === 'atlas' ? 'serve with GODIESEL_DISABLE_LIVE_PROVIDERS=1, or set EXPECT_RENDERER=google.' : 'serve with a Google key, or set EXPECT_RENDERER=atlas.'));
    await ctx.close();
    continue;
  }
  check('the visible link opened the expected renderer', true, engine);
  check('and it is ready', state === 'ready', state ?? '');

  /* The day keeps its own name here. `route.name` is the generated region
     label, so this headlined "Crete, Greece" for "the final boss". */
  const hud = await p.evaluate((renderer)=>{
    const h1 = renderer === 'atlas'
      ? document.querySelector('[data-ui="route-context-hud"] h1')
      : document.querySelector('[data-testid="replay-stage"] header h1');
    const sec = renderer === 'atlas' ? h1?.nextElementSibling : h1?.previousElementSibling;
    return h1 ? {
      headline:h1.textContent.trim(), secondary:(sec?.textContent||'').trim(),
      headlineSize:parseFloat(getComputedStyle(h1).fontSize),
      secondarySize:sec?parseFloat(getComputedStyle(sec).fontSize):null,
    } : null;
  }, EXPECT_RENDERER);
  check('Replay headlines the personal title', hud?.headline === 'the final boss', `"${hud?.headline}"`);
  if (EXPECT_RENDERER === 'atlas') {
    check('with place and date secondary', /Crete, Greece/.test(hud?.secondary ?? '') && /2025/.test(hud?.secondary ?? ''), `"${hud?.secondary}"`);
  } else {
    // Story Flight's header names the day and nothing else; place and date are not part of it.
    check('with its eyebrow secondary', /now replaying/i.test(hud?.secondary ?? ''), `"${hud?.secondary}"`);
  }
  check('and the hierarchy is right', (hud?.secondarySize ?? 99) < (hud?.headlineSize ?? 0), `${hud?.headlineSize}px over ${hud?.secondarySize}px`);
  check('entered with the journal cast', await p.evaluate(()=>Boolean(document.querySelector('.seed-replay-warm [data-testid="replay-stage"]'))));

  // Story Flight hides its chrome while playing; pointer movement brings it back.
  const reveal = async () => { if (EXPECT_RENDERER === 'google') { await p.mouse.move(vp.width/2, vp.height/2); await p.mouse.move(vp.width/2+4, vp.height/2+4); await p.waitForTimeout(200); } };
  const readout = p.locator('text=/\\d+\\.\\d+ \\/ \\d+\\.\\d+ km/').first();
  const read = async () => {
    const progress = await stage.getAttribute('data-progress').catch(()=>null);
    if (progress !== null && EXPECT_RENDERER === 'google') return Number(progress) / 1000;
    const t = await readout.innerText().catch(()=>'');
    const m = t.match(/([\d.]+)\s*\/\s*([\d.]+)/);
    return m ? Number(m[1]) : null;
  };
  const before = await read();
  check('progress readout present', before !== null, `${before} km`);
  await reveal();
  await p.getByRole('button',{name:/^Play route$/}).click();
  const series=[];
  for (let i=0;i<7;i++){ await p.waitForTimeout(900); series.push(await read()); }
  const advanced = series.filter(v=>v!==null).some(v=>v > (before ?? 0) + 0.05);
  const monotonic = series.every((v,i)=> i===0 || v===null || series[i-1]===null || v >= series[i-1] - 0.001);
  check('playback actually advances', advanced, `${before} -> ${series.map(v=>v?.toFixed(2)).join(' -> ')} km`);
  check('and advances monotonically', monotonic);
  await reveal();
  await p.getByRole('button',{name:/^Pause route$/}).click().catch(()=>{});
  await p.waitForTimeout(600);
  const paused=await read(); await p.waitForTimeout(1500);
  check('pause holds', Math.abs((await read())-paused) < 0.05, `${paused?.toFixed(2)} km`);
  if (EXPECT_RENDERER === 'atlas') {
    /* The Replay canvas does not keep its drawing buffer, so read the compositor
       output through a screenshot rather than drawImage. */
    const shotPath = `${DIR}/replay-${vp.name}.png`;
    await p.screenshot({ path: shotPath });
    const png = PNG.sync.read(fs.readFileSync(shotPath));
    let warm=0, cobalt=0;
    for (let i=0;i<png.data.length;i+=4){
      const r=png.data[i],g=png.data[i+1],bb=png.data[i+2];
      if(r>150&&r-g>35&&r-bb>45) warm++;
      if(bb>120&&bb-r>45&&bb-g>20) cobalt++;
    }
    check('journal thread is on the dark surface, not the cobalt default', warm>200 && warm>cobalt, `warm ${warm}px vs cobalt ${cobalt}px`);
  } else {
    // Google 3D draws its own cinematic filament; the journal thread style is
    // an Atlas-replay treatment, so there is no thread identity to check here.
    await p.screenshot({ path: `${DIR}/replay-google-${vp.name}.png` });
    console.log('  --   thread identity not applicable: Story Flight uses its own filament');
  }

  await reveal();
  /* return through the VISIBLE links only */
  // Atlas replay's way back is a link; Story Flight's is a labelled button.
  await p.getByRole(EXPECT_RENDERER === 'google' ? 'button' : 'link',{name:/Route story|Back to Atlas|Route guide/i}).first().click();
  await p.waitForTimeout(4500);
  check('visible link returns to the day', p.url().includes('/story/14130782031'), new URL(p.url()).hash.slice(0,70));
  await p.locator('header a').first().click(); await p.waitForTimeout(5000);
  const back=new URL(p.url()).hash;
  check('visible link returns to the journal', back.includes('/atlas'), back.slice(0,95));
  check('with the region and route intact', back.includes('region=Crete') && back.includes('route=14130782031'));
  check('and the reading position restored', (await p.evaluate(()=>document.querySelector('[data-journal-scroller]')?.scrollTop))===parked, `${parked} -> ${await p.evaluate(()=>document.querySelector('[data-journal-scroller]')?.scrollTop)}`);
  console.log('  page errors:', errs.length, errs.slice(0,2));
  await ctx.close();
}
await b.close();
fs.writeFileSync(`${DIR}/renderer-${EXPECT_RENDERER}.json`, JSON.stringify({ expected: EXPECT_RENDERER, base: BASE, proven, failures: fails, at: new Date().toISOString() }, null, 2));
console.log(`\nrenderer proven: ${[...new Set(proven.map((item) => item.engine))].join(", ")} (expected ${ENGINE[EXPECT_RENDERER]})`);
console.log(fails.length?`\nFAILED: ${fails.join(' | ')}`:'\nReplay continuity verified on both sizes.');
process.exit(fails.length?1:0);
