import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createReceipt,markdown} from './replay-verification-receipt.mjs';
const revision='a'.repeat(40);
const outcomes=Object.fromEntries(['typecheck','unit','browser','live_build','cloudflare','live'].map(k=>[k,'success']));
function fixture(fn){const dir=mkdtempSync(join(tmpdir(),'replay-receipt-'));try{fn(dir);}finally{rmSync(dir,{recursive:true,force:true});}}
const report=status=>({suites:[{specs:[{title:'Runner 9850',tests:[{expectedStatus:'passed',results:[{status,duration:12}]}]}]}]});
test('missing reports never pass even with green steps',()=>fixture(proof=>assert.equal(createReceipt({proof,results:proof,revision,outcomes}).automatedVerdict,'unconfirmed')));
test('actual failed journey overrides other successes',()=>fixture(proof=>{
  writeFileSync(join(proof,'browser-results.json'),JSON.stringify(report('passed')));writeFileSync(join(proof,'live-results.json'),JSON.stringify(report('timedOut')));
  const r=createReceipt({proof,results:proof,revision,outcomes:{...outcomes,live:'failure'}});assert.equal(r.automatedVerdict,'failed');assert.equal(r.suites.live[0].verdict,'failed');
}));
test('passing automation never promotes human visual or device approval',()=>fixture(proof=>{
  for(const kind of ['browser','live'])writeFileSync(join(proof,`${kind}-results.json`),JSON.stringify(report('passed')));
  writeFileSync(join(proof,'cloudflare-preview-url.txt'),'https://abcdef01.godiesel.pages.dev\n');
  const r=createReceipt({proof,results:proof,revision,outcomes});assert.equal(r.automatedVerdict,'passed');assert.equal(r.visualApproval,'requires-human-review');assert.match(markdown(r),/Runner 9850/);
}));
test('rejects sensitive or moving preview URLs',()=>fixture(proof=>{
  writeFileSync(join(proof,'cloudflare-preview-url.txt'),'https://evil.example/?key=secret');const r=createReceipt({proof,results:proof,revision,outcomes});assert.equal(r.preview,null);assert.doesNotMatch(JSON.stringify(r),/evil|secret/);
}));
