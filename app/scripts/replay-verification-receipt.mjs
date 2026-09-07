import {existsSync,readFileSync,readdirSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,relative,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const steps=['typecheck','unit','browser','live_build','cloudflare','live'];
const permitted=new Set(['success','failure','cancelled','skipped']);
function readJson(path){try{return JSON.parse(readFileSync(path,'utf8'));}catch{return null;}}
function testsOf(report){
  const tests=[];
  function walk(suite){for(const spec of suite.specs??[])for(const test of spec.tests??[]){
    const last=test.results?.at(-1);const status=last?.status??'not-run';
    tests.push({title:spec.title,project:test.projectName??null,status,durationMs:last?.duration??null,
      verdict:status==='passed'&&test.expectedStatus!=='failed'?'passed':status==='skipped'?'skipped':status==='failed'||status==='timedOut'?'failed':'unconfirmed'});
  }for(const child of suite.suites??[])walk(child);}
  if(report)for(const suite of report.suites??[])walk(suite);
  return tests;
}
function filesIn(root){if(!existsSync(root))return [];return readdirSync(root,{withFileTypes:true}).flatMap(e=>e.isDirectory()?filesIn(join(root,e.name)):[join(root,e.name)]);}
/** Missing reports and skipped gates never count as successful acceptance. */
export function createReceipt({proof,results,revision,outcomes={},runId=null}){
  const stages=Object.fromEntries(steps.map(k=>[k,permitted.has(outcomes[k])?outcomes[k]:'unconfirmed']));
  const candidate=(existsSync(join(proof,'cloudflare-preview-url.txt'))?readFileSync(join(proof,'cloudflare-preview-url.txt'),'utf8'):'').trim();
  const preview=stages.cloudflare==='success'&&/^https:\/\/[a-z0-9]+\.godiesel\.pages\.dev$/.test(candidate)?candidate:null;
  const suites={browser:testsOf(readJson(join(proof,'browser-results.json'))),live:testsOf(readJson(join(proof,'live-results.json')))};
  const pictures=filesIn(results).filter(p=>p.endsWith('.png')).map(p=>({path:relative(proof,p).replaceAll('\\','/'),
    kind:p.includes('/cinematic-live/')?'live-provider':'synthetic-or-interface'}));
  const passed=steps.every(k=>stages[k]==='success')&&Object.values(suites).every(t=>t.length>0&&t.every(x=>x.verdict==='passed'));
  return {schema:'godiesel-replay-verification-v1',revision:/^[a-f0-9]{40}$/.test(revision??'')?revision:null,
    runId,preview,stages,suites,frames:pictures,automatedVerdict:passed?'passed':steps.some(k=>stages[k]==='failure')?'failed':'unconfirmed',
    visualApproval:'requires-human-review',devicePerformance:'not-established-by-ci',generatedAt:new Date().toISOString()};
}
export function markdown(receipt){
  return `# Replay verification — ${receipt.revision??'unknown source'}\n\nAutomated verdict: **${receipt.automatedVerdict}**. Visual approval: **not inferred from automation**.\n\nPreview: ${receipt.preview??'not deployed / unconfirmed'}\n\n`+
    '| Stage | Outcome |\n|---|---|\n'+Object.entries(receipt.stages).map(([k,v])=>`| ${k} | ${v} |`).join('\n')+
    '\n\n## Browser and live journeys\n\n'+Object.entries(receipt.suites).map(([name,tests])=>`### ${name}\n\n`+(tests.length?tests.map(t=>`- **${t.verdict}** — ${t.title.replaceAll('\n',' ')} (${t.status})`).join('\n'):'No completed report.')).join('\n\n')+
    '\n\n## Captured frames\n\n'+receipt.frames.map(f=>`- [${f.kind}: ${f.path.split('/').at(-1)}](${encodeURI(f.path)})`).join('\n')+
    '\n\nSynthetic fixtures are not live imagery approval. CPU/software browser timings are not owner-device performance. No provider URLs, keys, raw tile bodies or traces are included in this receipt.\n';
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const proof=resolve(process.argv[2]??'../proof');mkdirSync(proof,{recursive:true});
  const outcomes=Object.fromEntries(steps.map(k=>[k,process.env[`REPLAY_${k.toUpperCase()}_OUTCOME`]]));
  const revision=existsSync(join(proof,'commit.txt'))?readFileSync(join(proof,'commit.txt'),'utf8').trim():null;
  const receipt=createReceipt({proof,results:resolve('test-results'),revision,outcomes,runId:process.env.GITHUB_RUN_ID??null});
  const text=markdown(receipt);writeFileSync(join(proof,'receipt.json'),JSON.stringify(receipt,null,2));writeFileSync(join(proof,'receipt.md'),text);
  if(process.env.GITHUB_STEP_SUMMARY)writeFileSync(process.env.GITHUB_STEP_SUMMARY,text,{flag:'a'});
  console.log(`Replay verification: ${receipt.automatedVerdict}; revision=${receipt.revision??'unknown'}; receipt saved.`);
}
