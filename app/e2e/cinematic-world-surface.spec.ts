import { test, expect } from "@playwright/test";
import { readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { syntheticGlb, syntheticTileset } from "./helpers/cinematic-fixture";
import type { CinematicWorldEnginePort } from "../src/surfaces/replay/world/cinematic-world-engine";
import type { WorldDiagnostics } from "../src/surfaces/replay/world/world-diagnostics";
function loweredCoarsePlane() {
  const source=syntheticGlb(), length=source.readUInt32LE(12);
  const data=JSON.parse(source.subarray(20,20+length).toString());data.nodes[0].translation=[0,-150,0];
  const text=Buffer.from(JSON.stringify(data));const json=Buffer.concat([text,Buffer.alloc((4-text.length%4)%4,32)]);
  const binary=source.subarray(28+length), header=Buffer.alloc(20), bh=Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(28+json.length+binary.length,8);
  header.writeUInt32LE(json.length,12);header.writeUInt32LE(0x4e4f534a,16);bh.writeUInt32LE(binary.length,0);bh.writeUInt32LE(0x004e4942,4);
  return Buffer.concat([header,json,bh,binary]);
}
test.use({launchOptions:{args:["--enable-unsafe-swiftshader"]}});
test("coarse terrain cannot drag the close camera underground while fine surface data is delayed",async({page},testInfo)=>{
  test.setTimeout(90_000);await page.setViewportSize({width:640,height:480});
  let release!:()=>void;const fine=new Promise<void>(resolve=>{release=resolve;});let fineRequested=false;
  const base=syntheticTileset();
  const tileset={...base,geometricError:512,root:{...base.root,geometricError:512,
    boundingVolume:{box:[0,0,1000,4000,0,0,0,4000,0,0,0,300]},
    content:{uri:"coarse.glb?session=synthetic"},children:[{boundingVolume:base.root.boundingVolume,geometricError:0,content:{uri:"fine.glb?session=synthetic"}}]}};
  await page.route("https://tile.googleapis.com/**",async request=>{
    const name=new URL(request.request().url()).pathname;
    if(name.includes("root.json")) return request.fulfill({json:tileset});
    if(name.includes("fine.glb")){fineRequested=true;await fine;}
    await request.fulfill({contentType:"model/gltf-binary",body:name.includes("coarse.glb")?loweredCoarsePlane():syntheticGlb()});
  });
  try {
    await page.goto("/#/routes");
    const runtime=readdirSync(path.resolve("dist/assets")).find(name=>/^cinematic-world-engine-.*\.js$/.test(name));expect(runtime).toBeTruthy();
    await page.evaluate(async url=>{
      const module=await import(/* @vite-ignore */url);const engine:CinematicWorldEnginePort=module.createCinematicWorldEngine();
      const container=document.createElement("div");container.id="surface-test";container.style.cssText="position:fixed;inset:0;z-index:100;--world-dock-height:0px";document.body.append(container);
      (window as unknown as {__surface:CinematicWorldEnginePort}).__surface=engine;
      engine.setEnvironment({quality:"balanced",light:"daylight",clouds:0,labels:false,reducedMotion:true});
      await engine.mount({apiKey:"synthetic",container,groundingMode:"mesh",
        initialCamera:{center:{lat:51,lng:-114,altitude:1000},headingDeg:0,rangeM:40000,tiltDeg:0,fovDeg:50,progressM:0},
        route:{slug:"synthetic-ground-support",name:"Synthetic camera support",lifecycle:"completed",distanceKm:2,centerLat:51,centerLng:-114,elevationStatus:"recorded",replay:{replayEligible:true,geometryStatus:"ready"},route:[{lat:51,lng:-114.01,elev:1000,d:0},{lat:51,lng:-113.99,elev:1000,d:2000}],provenance:{discontinuities:[],elevation:{status:"recorded"}}} as never,onStatus:()=>{},
      });
      engine.setPlaybackContext?.({playing:false,following:true,progressM:0,speed:1,cameraMode:"runner",groundingMode:"mesh",rangeScale:1,cameraSettling:false,settingsOpen:false,reducedMotion:true});
      const caption=document.createElement("div");caption.textContent="SYNTHETIC CAMERA SUPPORT — NOT GOOGLE IMAGERY";caption.style.cssText="position:absolute;top:8px;left:8px;background:white;color:#111;padding:8px;font:12px Arial";container.append(caption);
    },`/assets/${runtime}`);
    const read=()=>page.evaluate(()=>{const detail={report:null};document.querySelector("#surface-test")!.dispatchEvent(new CustomEvent("godiesel:world-diagnostics",{detail}));return detail.report as unknown as WorldDiagnostics;});
    await expect.poll(async()=>(await read()).terrain.renderedMeshes).toBeGreaterThan(0);
    await page.evaluate(()=>(window as unknown as {__surface:CinematicWorldEnginePort}).__surface.setCamera({center:{lat:51,lng:-114,altitude:1000},headingDeg:0,rangeM:179,tiltDeg:65,fovDeg:50,progressM:0}));
    await expect.poll(()=>fineRequested).toBe(true);
    // Allow actual grounding updates, not merely the initial camera assignment.
    await page.waitForTimeout(1200);
    const waiting=await read();expect(waiting.camera.targetCorrectionM).toBe(0);expect(waiting.camera.targetSurfaceErrorM).toBeNull();expect(waiting.camera.heightM).toBeGreaterThan(1050);
    expect(waiting.terrain.streaming?.cameraSupport?.active).toBe(true);
    await page.screenshot({path:testInfo.outputPath("camera-protected-from-coarse-height.png")});
    release();
    await expect.poll(async()=>(await read()).camera.targetSurfaceErrorM).toBe(0);
    await expect.poll(async()=>(await read()).camera.clearanceState).toBe("measured");
    const ready=await read();expect(ready.camera.clearanceM).toBeGreaterThanOrEqual(18);expect(Math.abs(ready.camera.targetCorrectionM!)).toBeLessThan(.1);
    expect(ready.terrain.view?.coverage.centerHit).toBe(true);expect(ready.contextLost).toBe(false);
    await page.screenshot({path:testInfo.outputPath("camera-grounded-on-fine-terrain.png")});
    writeFileSync(testInfo.outputPath("camera-support-proof.json"),JSON.stringify({synthetic:true,waiting,ready},null,2));
  }finally{release();if(!page.isClosed())await page.evaluate(()=>(window as unknown as {__surface?:CinematicWorldEnginePort}).__surface?.destroy());}
});
