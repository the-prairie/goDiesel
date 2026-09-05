/** Independent tiny browser fixture: validates the WALK HARNESS, never goDiesel. */
import http from 'node:http';
export const fixtureScript = `
const root = document.querySelector('main');
let tick;
function go(hash) { location.hash = hash; }
function render() {
 clearInterval(tick);
 const hash = location.hash || '#/atlas';
 const nav = '<nav><a href="#/atlas">Atlas</a> <a href="#/finder">Finder</a> <a href="#/routes">Routes</a> <a href="#/admin">Admin</a></nav>';
 let body = '';
 if(hash.startsWith('#/replay/')) {
  body = '<section data-testid="replay-stage" data-state="ready"><h1>Fixture Route</h1><div data-testid="google-route-progress">0 km</div><button id="play">Play route</button><nav aria-label="Replay chapters"><button>Origin</button><button>High point</button></nav><a href="#/routes/fixture">Route story</a></section>';
 } else if(hash.startsWith('#/routes/plan')) {
  body = '<h1>Kyoto</h1><p>This is a plan, not a recorded activity.</p>';
 } else if(hash.startsWith('#/routes/fixture')) {
  body = '<section aria-label="Route story"><h1>Fixture Route</h1><section aria-label="Route geography"><p>The fixture route geography</p></section><a href="#/replay/fixture">Cinematic replay</a><a href="#/replay/fixture">Cinematic replay</a></section>';
 } else if(hash.startsWith('#/routes')) {
  body = '<h1>Routes</h1><input type="search" aria-label="Search routes"><button id="plans">Planned routes</button><section aria-label="Route results"><article><h2>Fixture Route</h2><a href="#/routes/fixture">Open Fixture Route</a></article></section><div id="plans-list"></div>';
 } else if(hash.startsWith('#/finder')) {
  body = '<h1>Plan the next day.</h1><button id="shape">Shape the day</button><div id="form"></div><section aria-label="Finder results"></section>';
 } else if(hash.startsWith('#/admin')) {
  body = '<h1>Admin</h1><p role="status">Read-only mode.</p><p>Read-only mode.</p><label>Vibe<textarea disabled>Owner note</textarea></label>';
 } else {
  body = '<h1>Atlas</h1><article aria-current="true"><h3>Fixture Route</h3><a href="#/replay/fixture">Open route</a></article>';
 }
 root.innerHTML = nav + body;
 document.querySelector('#play')?.addEventListener('click', e=>{ if(e.target.textContent==='Play route'){e.target.textContent='Pause route';tick=setInterval(()=>{document.querySelector('[data-testid="google-route-progress"]').textContent=Date.now()+' km'},100)}else{clearInterval(tick);e.target.textContent='Play route'}});
 document.querySelector('#plans')?.addEventListener('click',()=>{document.querySelector('#plans-list').innerHTML = localStorage.plan ? '<article aria-label="Planned route Kyoto"><a href="#/routes/plan">Open planned Kyoto route</a></article>':''});
 document.querySelector('#shape')?.addEventListener('click',form);
}
function form(){
 document.querySelector('#form').innerHTML='<form aria-label="Find a route"><label>Place<input id="place"></label><label>Activity<select><option>Run</option></select></label><label>Distance<span>km</span><input></label><label>Terrain<select><option value="mixed">Mixed</option></select></label><label>Vibe<input></label><button>Find curated routes</button></form>';
 document.querySelector('form').onsubmit=e=>{e.preventDefault();const place=document.querySelector('#place').value;const result=document.querySelector('[aria-label="Finder results"]');document.querySelector('#form').innerHTML='';document.querySelector('#shape').textContent='Edit filters';if(place==='Kyoto'){result.innerHTML='<article aria-label="Kyoto, Japan candidate"><h2>Kyoto, Japan</h2><button id="save">Save planned route</button><div role="status"></div></article>';document.querySelector('#save').onclick=()=>{localStorage.plan='yes';document.querySelector('[role="status"]').textContent='Saved to Planned routes'}}else{result.innerHTML='<p role="status">No owner-curated route matches this search yet</p><button id="edit">Edit search</button>';document.querySelector('#edit').onclick=form}};
}
addEventListener('hashchange',render); render();
`;
export async function serveFixture({ brokenReturn = false, blankProgress = false, httpDetails = false } = {}) {
  let script = fixtureScript;
  if (brokenReturn) script = script.replace('href="#/routes/fixture">Route story', 'href="#/routes/wrong">Route story');
  if (blankProgress) script = script.replace("Date.now()+' km'", "'0 km'");
  if (httpDetails) script = script.replace(
    `body = '<section aria-label="Route story"><h1>Fixture Route</h1><section aria-label="Route geography"><p>The fixture route geography</p></section><a href="#/replay/fixture">Cinematic replay</a><a href="#/replay/fixture">Cinematic replay</a></section>';`,
    `body = '<p role="status">Loading route story.</p>'; queueMicrotask(async()=>{ const response = await fetch('/data/routes/fixture.json'); root.innerHTML = nav + (response.ok ? '<section aria-label="Route story"><h1>Fixture Route</h1><p>Original server data restored</p></section>' : '<p role="alert">Route request failed with status 503</p><button id="retry">Retry</button>'); document.querySelector('#retry')?.addEventListener('click', render); });`
  );
  const writes = [];
  const server = http.createServer((request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) writes.push(request.method);
    if (request.url === '/data/routes/fixture.json') { response.setHeader('Content-Type', 'application/json'); response.end('{\"fixture\":true}'); return; }
    if (request.url === '/fixture.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(script); return; }
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><html lang="en"><meta charset="utf-8"><title>Harness fixture — NOT goDiesel</title><style>body{font:18px system-ui;margin:36px}nav a{display:inline-block;padding:16px}button,input,select{min-height:44px;margin:12px}label{display:block}section{padding:24px;border:1px solid}h1{font-size:36px}</style><header>Harness fixture — NOT goDiesel</header><main></main><script src="/fixture.js"></script></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { target: `http://127.0.0.1:${server.address().port}/`, writes, close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }) };
}
