/**
 * Journal control-size audit.
 *
 * The application's agreed sizes: 44px minimum, 48px for mobile controls, on
 * both axes. This is a different check from "no target under the WCAG 2.5.8
 * 24px floor" - it is the product's own, stricter rule, and it caught six
 * controls that passed the 24px check: the four journal nav links at 44x44 and
 * the two plate framing toggles at 59x44 and 65x44, all fine on desktop and all
 * short of 48px on a phone.
 *
 * Provider attribution is reported separately and never sized to this rule.
 * MapLibre's required credit is its own control, its links are inline text, and
 * padding it out to 48px would put a 48px-tall band of chrome over the
 * geography on every surface.
 *
 * Needs a running dev or preview server.
 *
 *   npm run dev
 *   npm run audit:journal-controls
 */
import { chromium } from "@playwright/test";
const BASE = process.env.BASE ?? "http://localhost:8787";
const C=encodeURIComponent('Crete, Greece'), B=encodeURIComponent('Banff/Kananaskis'), K=encodeURIComponent('Kyoto, Japan');
const D={width:1440,height:900}, M={width:390,height:844};
const STATES=[
 ['atlas',D,`/#/lab/design-seeds/b/atlas?region=${C}&route=14130782031&theme=journal`],
 ['atlas',M,`/#/lab/design-seeds/b/atlas?region=${C}&route=14130782031&theme=journal`],
 ['short note',D,`/#/lab/design-seeds/b/story/14130782031?region=${C}&theme=journal`],
 ['short note',M,`/#/lab/design-seeds/b/story/14130782031?region=${C}&theme=journal`],
 ['no note',D,`/#/lab/design-seeds/b/story/15573295095?region=${B}&theme=journal`],
 ['no note',M,`/#/lab/design-seeds/b/story/15573295095?region=${B}&theme=journal`],
 ['long title',M,`/#/lab/design-seeds/b/story/14080158961?region=${C}&theme=journal`],
 ['photograph',M,`/#/lab/design-seeds/b/story/17654151284?region=${K}&theme=journal`],
 ['imported',M,`/#/lab/design-seeds/b/story/3519505225411091950?theme=journal`],
];
const AUDIT = `(() => {
  const min = window.innerWidth < 768 ? 48 : 44;
  const controls=[], provider=[];
  const sel='a[href],button,[role="button"],[role="slider"],input:not([type=hidden]),select,textarea,summary,[tabindex]:not([tabindex="-1"])';
  for(const el of document.querySelectorAll(sel)){
    const cs=getComputedStyle(el);
    if(cs.visibility==='hidden'||cs.display==='none'||Number(cs.opacity)===0) continue;
    const r=el.getBoundingClientRect();
    if(r.width<1&&r.height<1) continue;
    const label=(el.getAttribute('aria-label')||el.textContent||el.tagName).trim().replace(/\\s+/g,' ').slice(0,40);
    const row={tag:el.tagName.toLowerCase(), role:el.getAttribute('role')||'', label, w:Math.round(r.width), h:Math.round(r.height)};
    if(el.closest('.maplibregl-ctrl-attrib, .maplibregl-ctrl')) { provider.push(row); continue; }
    controls.push(row);
  }
  return {min, controls, provider};
})()`;
const b=await chromium.launch();
let fails=0;
for(const [name,vp,path] of STATES){
  const ctx=await b.newContext({viewport:vp,isMobile:vp===M,hasTouch:vp===M});
  const p=await ctx.newPage();
  await p.goto(BASE+path,{waitUntil:'load'}); await p.waitForTimeout(8500);
  const r=await p.evaluate(AUDIT);
  const under=r.controls.filter(c=>c.w<r.min||c.h<r.min);
  console.log(`\n${name} @ ${vp.width}x${vp.height}  (minimum ${r.min}px)`);
  console.log(`  app controls: ${r.controls.length}, under minimum: ${under.length}`);
  for(const c of r.controls) console.log(`    ${(c.w+'x'+c.h).padEnd(9)} ${c.tag}${c.role?'['+c.role+']':''} "${c.label}"${(c.w<r.min||c.h<r.min)?'   << UNDER':''}`);
  console.log(`  provider attribution (separate): ${r.provider.map(c=>`${c.w}x${c.h} ${c.tag}`).join(', ')||'none'}`);
  fails+=under.length;
  await ctx.close();
}
await b.close();
console.log(`\ntotal app controls under the agreed minimum: ${fails}`);
if (fails) process.exit(1);
