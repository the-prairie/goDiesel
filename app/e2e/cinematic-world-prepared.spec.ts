import {expect,test,type Page} from "@playwright/test";
import {readFileSync,readdirSync,writeFileSync} from "node:fs";
import path from "node:path";
import {syntheticGlb,syntheticRoadTile,syntheticTileset} from "./helpers/cinematic-fixture";
import type {WorldDiagnostics} from "../src/surfaces/replay/world/world-diagnostics";

test.use({launchOptions:{args:["--enable-unsafe-swiftshader"]}});
function halfPlane(east:boolean){
  const source=syntheticGlb(),length=source.readUInt32LE(12),gltf=JSON.parse(source.subarray(20,20+length).toString());
  // Extend each half beyond the 20 km camera far plane. The initial shot
  // looks west, away from the deliberately withheld eastern destination.
  gltf.nodes[0].scale=[3,1,6];gltf.nodes[0].translation=[east?12000:-12000,0,0];
  const text=Buffer.from(JSON.stringify(gltf)),json=Buffer.concat([text,Buffer.alloc((4-text.length%4)%4,32)]),binary=source.subarray(28+length),header=Buffer.alloc(20),bh=Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(28+json.length+binary.length,8);header.writeUInt32LE(json.length,12);header.writeUInt32LE(0x4e4f534a,16);bh.writeUInt32LE(binary.length,0);bh.writeUInt32LE(0x004e4942,4);
  return Buffer.concat([header,json,bh,binary]);
}
const read=(page:Page)=>page.evaluate(()=>{const detail={report:null};document.querySelector("[data-world-terrain]")!.dispatchEvent(new CustomEvent("godiesel:world-diagnostics",{detail}));return detail.report as unknown as WorldDiagnostics;});
async function fixture(page:Page){
  page.setDefaultTimeout(15000);
  await page.setViewportSize({width:960,height:640});await page.emulateMedia({reducedMotion:"reduce"});
  const route=JSON.parse(readFileSync("public/data/routes/14130782031.json","utf8"));
  Object.assign(route,{name:"Synthetic prepared journey",activity_name:"SYNTHETIC PREPARED VIEW — NOT GOOGLE IMAGERY",region:"Synthetic pipeline",center_lat:51,center_lng:-114,distance_km:2,mid_idx:20,
    route:Array.from({length:41},(_,i)=>({lat:51,lng:i<4?-114.01-i*.0005:-114.01+(i-4)*.00065,elev:1000,d:i*50,elapsed_s:i*20}))});
  route.provenance.discontinuities=[];route.replay.point_count=41;
  await page.route("**/data/routes/14130782031.json",r=>r.fulfill({json:route}));
  const base=syntheticTileset();const tiles={...base,geometricError:512,root:{...base.root,boundingVolume:{box:[0,0,1000,24000,0,0,0,24000,0,0,0,20]},geometricError:512,content:undefined,
    children:[false,true].map(east=>({boundingVolume:{box:[east?12000:-12000,0,1000,12000,0,0,0,24000,0,0,0,20]},geometricError:0,content:{uri:`${east?'east':'west'}.glb?session=synthetic`}}))}};
  let release!:()=>void;const deferred=new Promise<void>(resolve=>release=resolve);let eastRequested=false;
  await page.route("https://tile.googleapis.com/**",async r=>{
    const url=new URL(r.request().url());if(url.pathname.includes("root.json"))return r.fulfill({json:tiles});
    const east=url.pathname.includes("east.glb");if(east){eastRequested=true;await deferred;}
    await r.fulfill({contentType:"model/gltf-binary",body:halfPlane(east)}).catch(()=>{});
  });
  await page.route("https://tiles.openfreemap.org/**",r=>{
    const match=/fixture\/(\d+)\/(\d+)\/(\d+)\.pbf/.exec(r.request().url());return match?r.fulfill({contentType:"application/x-protobuf",body:syntheticRoadTile(+match[1],+match[2],+match[3])}):r.fulfill({json:{maxzoom:14,tiles:["https://tiles.openfreemap.org/fixture/{z}/{x}/{y}.pbf"]}});
  });
  await page.goto("/#/routes");const runtime=readdirSync(path.resolve("dist/assets")).find(n=>/^cinematic-world-engine-.*\.js$/.test(n));expect(runtime).toBeTruthy();
  await page.evaluate(async url=>{const module=await import(/* @vite-ignore */url),engine=module.createCinematicWorldEngine(),mount=engine.mount.bind(engine);
    engine.mount=(options:object)=>mount({...options,apiKey:"synthetic-credential"});window.__GODIESEL_CINEMATIC_WORLD_FACTORY__=()=>engine;location.hash="/replay/14130782031?renderer=cinematic";},`/assets/${runtime}`);
  await expect(page.locator("[data-world-terrain]")).toHaveAttribute("data-world-terrain","ready",{timeout:45000});
  return {release,get eastRequested(){return eastRequested;}};
}

test("real prepared destination keeps the outgoing view, latest scrub and Pause win, then free camera and recenter work",async({page},info)=>{
  test.setTimeout(120000);const gate=await fixture(page);
  try {
    await page.getByRole("button",{name:"Replay settings",exact:true}).click();
    await page.getByRole("button",{name:"Chase",exact:true}).click();
    await page.getByRole("button",{name:"Replay settings",exact:true}).click();
    await expect.poll(async()=>(await read(page)).playback?.cameraMode,{timeout:30000}).toBe("chase");
    await page.screenshot({path:info.outputPath("01-synthetic-outgoing-view.png")});
    await page.getByRole("button",{name:"Play route",exact:true}).click();
    const slider=page.getByRole("slider",{name:"Route progress",exact:true});await slider.fill("1500");
    await expect.poll(async()=>(await read(page)).preparation?.phase).toBe("preparing");
    expect(gate.eastRequested).toBe(true);const displayed=(await read(page)).playback!.progressM;
    await page.waitForTimeout(600);expect((await read(page)).playback!.progressM).toBe(displayed);
    const preparing=await read(page);
    expect(preparing.preparation?.retainedDisplayModels).toBeGreaterThan(0);
    expect(preparing.preparation?.displayTraversalPaused).toBe(true);
    expect(preparing.preparation?.pinnedBytes).toBeLessThanOrEqual(288*1024*1024);
    await expect(slider).toHaveValue("1500");await expect(page.getByTestId("replay-selected-position")).toBeVisible();
    await page.screenshot({path:info.outputPath("02-synthetic-selected-not-yet-displayed.png")});
    await slider.fill("1800");await page.getByRole("button",{name:"Pause route",exact:true}).click();
    await expect.poll(async()=>(await read(page)).playback?.playing).toBe(false);
    await expect.poll(async()=>(await read(page)).preparation?.selectedProgressM).toBe(1800);
    gate.release();
    await expect.poll(async()=>(await read(page)).playback?.progressM,{timeout:30000}).toBe(1800);
    await expect.poll(async()=>(await read(page)).camera.displayedProgressM).toBe(1800);
    const arrived=await read(page);expect(arrived.preparation?.displayTraversalPaused).toBe(false);expect(arrived.playback?.playing).toBe(false);expect(arrived.preparation?.completed).toBeGreaterThanOrEqual(2);
    expect(arrived.preparation?.cancelled).toBeGreaterThanOrEqual(1);expect(arrived.camera.sightline).toBe("clear");expect(arrived.contextLost).toBe(false);
    await expect(page.getByTestId("replay-selected-position")).toHaveCount(0);
    await page.screenshot({path:info.outputPath("03-synthetic-prepared-arrival.png")});
    const box=(await page.getByTestId("cinematic-world-canvas").boundingBox())!;
    await page.mouse.move(box.x+480,box.y+310);await page.mouse.down();await page.mouse.move(box.x+520,box.y+330,{steps:5});await page.mouse.up();
    await expect.poll(async()=>(await read(page)).camera.owner).toBe("free");
    await page.getByRole("button",{name:"Recenter route",exact:true}).click();
    await expect.poll(async()=>(await read(page)).camera.owner,{timeout:30000}).toBe("following");
    expect((await read(page)).playback?.playing).toBe(false);
    writeFileSync(info.outputPath("prepared-journey.json"),JSON.stringify({synthetic:true,displayed,arrived,final:await read(page)},null,2));
    await page.getByRole("button",{name:"Route story",exact:true}).click();await expect(page.locator("[data-world-terrain]")).toHaveCount(0);
  }finally{gate.release();}
});

test("a cancelled cold destination cannot move the scene when its delayed terrain eventually arrives",async({page},info)=>{
  test.setTimeout(90000);const gate=await fixture(page);
  try {
    const before=(await read(page)).playback!.progressM;
    await page.getByRole("slider",{name:"Route progress",exact:true}).fill("1800");
    await expect.poll(async()=>(await read(page)).preparation?.phase).toBe("preparing");
    await page.getByRole("button",{name:"Stay here",exact:true}).click();
    gate.release();await page.waitForTimeout(1500);
    const after=await read(page);expect(after.playback!.progressM).toBe(before);expect(after.playback!.playing).toBe(false);expect(after.preparation?.candidateCameras).toBe(0);expect(after.preparation?.displayTraversalPaused).toBe(false);
    await page.screenshot({path:info.outputPath("cancelled-destination-keeps-original-scene.png")});
  }finally{gate.release();}
});

test.afterEach(async({page},info)=>{
  const report=await read(page).catch(()=>null);
  if(report)writeFileSync(info.outputPath("prepared-final-state.json"),JSON.stringify({synthetic:true,report},null,2));
});
