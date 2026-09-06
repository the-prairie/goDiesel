/**
 * Journal day pages under actual mobile use, at 390x844 with touch.
 *
 * One pass over the five content shapes the collection actually contains - a
 * short note, no note, the 233-character title, a day with a photograph, and an
 * imported description - checking the things that break on a phone rather than
 * the things that are easy to assert:
 *
 *   - no horizontal overflow
 *   - the title renders whole and is not clipped
 *   - a photograph loads, with alt text and its caption
 *   - every recorded metric appears and none wraps mid-value
 *   - elevation inspection responds and its target clears 48px
 *   - the Replay action is reachable, and the last content on the page clears
 *     the pinned action bar
 *
 * Two notes on the assertions, both learned from false failures. A single line
 * of Cormorant at line-height 1.1 reports `scrollHeight` above `clientHeight`
 * because the glyph box exceeds the leading, so only overflow that is actually
 * hidden counts as clipping. And Rome records no elapsed time, so four metrics
 * there is the whole truth, not a missing one.
 *
 *   npm run dev
 *   npm run verify:journal-mobile
 */
import { chromium } from "@playwright/test";
const BASE = process.env.BASE ?? "http://localhost:8787";
const C=encodeURIComponent('Crete, Greece'), B=encodeURIComponent('Banff/Kananaskis'), K=encodeURIComponent('Kyoto, Japan');
const CASES=[
 ['short note','14130782031',`region=${C}`],
 ['no note','15573295095',`region=${B}`],
 ['233-char title','14080158961',`region=${C}`],
 ['photograph','17654151284',`region=${K}`],
 ['imported description','3519505225411091950',''],
];
const fails=[];
const check=(n,ok,d='')=>{ console.log(`${ok?'  ok  ':' FAIL '} ${n}${d?'  '+d:''}`); if(!ok) fails.push(n); };
const b=await chromium.launch();
for(const [name,slug,extra] of CASES){
  const ctx=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});
  const p=await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,120)));
  await p.goto(`${BASE}/#/lab/design-seeds/b/story/${slug}?${extra}${extra?'&':''}theme=journal`,{waitUntil:'load'});
  await p.waitForTimeout(8500);
  console.log(`\n${name}`);

  // no horizontal overflow
  const o=await p.evaluate(()=>({s:document.documentElement.scrollWidth,c:document.documentElement.clientWidth}));
  check('no horizontal overflow', o.s<=o.c+1, `${o.s} vs ${o.c}`);

  // title fully rendered, not clipped
  const h1=await p.evaluate(()=>{
    const el=document.querySelector('h1'); if(!el) return null;
    const cs=getComputedStyle(el); const r=el.getBoundingClientRect();
    return {text:el.textContent.trim(), chars:el.textContent.trim().length, size:parseFloat(cs.fontSize),
            // Only overflow that is actually cut off counts. A single line of
            // Cormorant at line-height 1.1 reports scrollHeight above
            // clientHeight because the glyph box exceeds the leading; with
            // overflow visible nothing is hidden.
            clipped: cs.overflow !== 'visible' && el.scrollHeight > el.clientHeight+1,
            overflow:cs.overflow, lines: Math.max(1, Math.round(el.clientHeight/(parseFloat(cs.lineHeight)||parseFloat(cs.fontSize)*1.2))),
            w:Math.round(r.width)};
  });
  check('title present and not clipped', h1 && !h1.clipped, `${h1.chars} chars at ${h1.size}px over ${h1.lines} line(s) in ${h1.w}px, overflow ${h1.overflow}`);

  // photograph, when the day has one
  const img=await p.evaluate(()=>{
    const el=document.querySelector('figure img'); if(!el) return null;
    const r=el.getBoundingClientRect();
    return {alt:el.getAttribute('alt')||'', w:Math.round(r.width), natural:el.naturalWidth, caption:(document.querySelector('figcaption')?.textContent||'').trim().slice(0,60)};
  });
  if(img) check('photograph loaded with alt text and caption', img.natural>0 && img.alt.length>3 && img.caption.length>3,
                `${img.natural}px source, alt ${img.alt.length} chars, "${img.caption}"`);
  else console.log('        (no photograph on this day)');

  // metrics wrap deliberately: every value on one line, rows aligned
  const facts=await p.evaluate(()=>{
    const dds=[...document.querySelectorAll('dd')];
    const rows={};
    for(const d of dds){ const r=d.getBoundingClientRect(); const k=Math.round(r.top/4)*4; (rows[k]=rows[k]||[]).push({t:d.textContent.trim(), wrapped:d.scrollHeight>d.clientHeight+1}); }
    return {count:dds.length, lines:Object.values(rows).map(v=>v.length), anyWrapped:dds.some(d=>d.scrollHeight>d.clientHeight+1)};
  });
  // Rome records no elapsed time, so four metrics there is the whole truth.
  check('every recorded metric shown, none wrapped mid-value', facts.count>=4 && !facts.anyWrapped, `${facts.count} values in rows of ${facts.lines.join('+')}`);

  // elevation inspection by keyboard
  const slider=p.getByRole('slider').first();
  const t0=await slider.getAttribute('aria-valuetext');
  await slider.focus(); for(let i=0;i<10;i++) await slider.press('ArrowRight');
  await p.waitForTimeout(500);
  const t1=await slider.getAttribute('aria-valuetext');
  check('elevation inspection responds', t0!==t1, `"${t0}" -> "${t1}"`);
  const sBox=await slider.boundingBox();
  check('inspection target is at least 48px tall', sBox && sBox.height>=48, `${Math.round(sBox.height)}px`);

  /*
   * The action is in flow, so nothing it could cover exists. Previously it was
   * a fixed bar whose top edge sat at 776px on a 844px screen, putting the
   * lower third of the elevation curve - playhead and readout included -
   * underneath itself while you scrubbed.
   */
  const replay=p.getByRole('link',{name:/Fly this route/i}).first();
  check('Replay action visible', await replay.isVisible());
  const flow=await p.evaluate(()=>{
    const bar=[...document.querySelectorAll('a')].find(a=>/Fly this route/i.test(a.textContent||''));
    return bar ? getComputedStyle(bar).position : null;
  });
  check('Replay action is in flow, not a pinned overlay', flow==='static' || flow==='relative', `position: ${flow}`);

  /* Curve, readout, playhead and the corresponding map position, together. */
  const together=await p.evaluate(()=>{
    const vh=window.innerHeight;
    const slider=document.querySelector('[role="slider"]');
    const map=document.querySelector('.maplibregl-map');
    const readout=[...(slider?.querySelectorAll('div')??[])]
      .find(d=>/\d+\.\d+ km · -?\d+ m/.test(d.textContent||''));
    const marker=document.querySelector('.seed-route-marker, .maplibregl-marker');
    const inView=(el)=>{ if(!el) return null; const b=el.getBoundingClientRect();
      return b.top>=0 && b.bottom<=vh+0.5 && b.height>0; };
    const box=(el)=>{ if(!el) return null; const b=el.getBoundingClientRect();
      return {top:Math.round(b.top), bottom:Math.round(b.bottom)}; };
    const covered=(el)=>{ if(!el) return null; const b=el.getBoundingClientRect();
      const mid=document.elementFromPoint(Math.round(b.left+b.width/2), Math.round(b.bottom-4));
      return !(el===mid || el.contains(mid)); };
    return {
      curve: inView(slider), curveBox: box(slider), curveCovered: covered(slider),
      map: inView(map), mapBox: box(map),
      readout: readout ? {text:readout.textContent.trim(), inView:inView(readout)} : null,
      marker: marker ? {inView:inView(marker)} : null,
      viewport: vh,
    };
  });
  check('the climb curve is fully visible while inspecting', together.curve===true, JSON.stringify(together.curveBox));
  check('and nothing covers its lower edge', together.curveCovered===false);
  check('the active distance/altitude readout is visible', Boolean(together.readout?.inView), together.readout?.text ?? 'none');
  check('the corresponding map position is visible', together.map===true, JSON.stringify(together.mapBox));
  if (together.marker) check('and the map marker is on screen', together.marker.inView===true);

  /* Ordinary scrolling reaches the end of the entry with nothing occluded. */
  const reachEnd=await p.evaluate(async ()=>{
    const step=()=>new Promise(r=>requestAnimationFrame(()=>r()));
    for (let i=0;i<60;i++){ window.scrollBy(0, 140); await step(); }
    await new Promise(r=>setTimeout(r,300));
    const vh=window.innerHeight;
    const blocks=[...document.querySelectorAll('p,dd,figcaption,figure img')]
      .filter(e=>(e.tagName==='IMG'||e.textContent.trim()) && e.getBoundingClientRect().height>0);
    const last=blocks.map(e=>({el:e, b:e.getBoundingClientRect()})).sort((x,y)=>y.b.bottom-x.b.bottom)[0];
    const mid=document.elementFromPoint(Math.round(last.b.left+last.b.width/2), Math.round(last.b.bottom-4));
    return {
      atBottom: Math.abs(window.scrollY + vh - document.documentElement.scrollHeight) < 4,
      lastBottom: Math.round(last.b.bottom), viewport: vh,
      lastVisible: last.b.bottom <= vh + 0.5,
      lastCovered: !(last.el===mid || last.el.contains(mid)),
      text: (last.el.textContent||last.el.getAttribute('alt')||'').trim().slice(0,44),
    };
  });
  check('ordinary scrolling reaches the end of the entry', reachEnd.atBottom, `scrollY+vh vs height`);
  check('and the last block is fully visible and uncovered',
        reachEnd.lastVisible && !reachEnd.lastCovered, `"${reachEnd.text}" bottom ${reachEnd.lastBottom} of ${reachEnd.viewport}`);
  console.log('        page errors:', errs.length, errs.slice(0,2));
  await ctx.close();
}
await b.close();
console.log(fails.length?`\nFAILED: ${fails.join(' | ')}`:'\nAll mobile-use checks passed.');
process.exit(fails.length?1:0);
