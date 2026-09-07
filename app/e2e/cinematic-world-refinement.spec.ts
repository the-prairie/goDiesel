import { test, expect } from "@playwright/test";
import { readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { syntheticCompressedGlb, syntheticTileset } from "./helpers/cinematic-fixture";
import type { CinematicWorldEnginePort } from "../src/surfaces/replay/world/cinematic-world-engine";
import type { WorldDiagnostics } from "../src/surfaces/replay/world/world-diagnostics";

// Cinema fixes the nominal terrain target at 6px. Balanced legitimately adapts
// to Light on software GPUs; that would conflate adaptation with this test of
// coarse-parent retention. Cloud work remains off. No renderer hook is mocked.
test.use({launchOptions:{args:["--enable-unsafe-swiftshader"]}});
test("a real coarse frontier stays drawable until delayed fine terrain replaces it at nominal quality", async ({page},testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({width:640,height:480});
  let release!: () => void;
  const detail = new Promise<void>(resolve => { release = resolve; });
  const requests: string[] = [];
  const base = syntheticTileset();
  const tileset = {...base, geometricError: 5, root:{...base.root,geometricError:5,
    content:{uri:"coarse.glb?session=synthetic"},children:[{boundingVolume:base.root.boundingVolume,geometricError:0,content:{uri:"detail.glb?session=synthetic"}}]}};
  await page.route("https://tile.googleapis.com/**",async request => {
    const name = new URL(request.request().url()).pathname; requests.push(name);
    if(name.includes("root.json")) return request.fulfill({json:tileset});
    if(name.includes("detail.glb")) await detail;
    await request.fulfill({contentType:"model/gltf-binary",body:syntheticCompressedGlb()});
  });
  try {
    await page.goto("/#/routes");
    const runtime = readdirSync(path.resolve("dist/assets")).find(name=>/^cinematic-world-engine-.*\.js$/.test(name));
    expect(runtime).toBeTruthy();
    await page.evaluate(async url=>{
      const module=await import(/* @vite-ignore */ url);
      const engine: CinematicWorldEnginePort=module.createCinematicWorldEngine();
      const container=document.createElement("div");container.id="frontier";
      container.style.cssText="position:fixed;inset:0;z-index:100;--world-dock-height:0px";
      document.body.append(container);
      (window as unknown as {__frontier:CinematicWorldEnginePort}).__frontier=engine;
      engine.setEnvironment({quality:"cinema",light:"daylight",clouds:0,labels:false,reducedMotion:true});
      await engine.mount({apiKey:"synthetic",container,groundingMode:"mesh",
        initialCamera:{center:{lat:51,lng:-114,altitude:1000},rangeM:179,headingDeg:0,tiltDeg:65,fovDeg:50,progressM:0},
        route:{slug:"synthetic-frontier",name:"Synthetic coarse to fine",lifecycle:"completed",distanceKm:2,centerLat:51,centerLng:-114,elevationStatus:"recorded",replay:{replayEligible:true,geometryStatus:"ready"},route:[{lat:51,lng:-114.01,elev:1000,d:0},{lat:51,lng:-113.99,elev:1000,d:2000}],provenance:{discontinuities:[],elevation:{status:"recorded"}}} as never,
        onStatus:()=>{},
      });
      const caption=document.createElement("div");caption.textContent="SYNTHETIC DELAYED-TILE REGRESSION — NOT GOOGLE IMAGERY";
      caption.style.cssText="position:absolute;top:8px;left:8px;background:white;color:#111;padding:8px;font:12px Arial";container.append(caption);
    },`/assets/${runtime}`);
    const read=()=>page.evaluate(()=>{const detail={report:null};document.querySelector("#frontier")!.dispatchEvent(new CustomEvent("godiesel:world-diagnostics",{detail}));return detail.report as unknown as WorldDiagnostics;});
    await expect.poll(async()=>(await read()).terrain.view?.coverage.hits).toBe(15);
    expect(requests.some(name=>name.includes("coarse.glb"))).toBe(true);
    await expect.poll(()=>requests.some(name=>name.includes("detail.glb"))).toBe(true);
    const waiting=await read();
    // Actual library traversal and WebGL draw, while the only fine tile is blocked.
    expect(waiting.terrain.renderedMeshes).toBeGreaterThan(0);
    expect(waiting.terrain.view?.coverage.centerHit).toBe(true);
    expect(waiting.quality).toMatchObject({requested:"cinema",effective:"cinema"});
    expect(waiting.terrain.refinement?.nominalTargetPx).toBe(6);
    await page.screenshot({path:testInfo.outputPath("coarse-frontier-while-detail-delayed.png")});
    release();
    await expect.poll(async()=>(await read()).terrain.refinement?.phase).toBe("settled");
    await expect.poll(async()=>(await read()).terrain.focus.geometricErrorM).toBe(0);
    const refined=await read();
    expect(refined.terrain.errorTargetPx).toBe(6);
    expect(refined.quality).toMatchObject({requested:"cinema",effective:"cinema"});
    expect(refined.terrain.view?.coverage.hits).toBe(15);
    expect(refined.contextLost).toBe(false);
    await page.screenshot({path:testInfo.outputPath("nominal-detail-after-replacement.png")});
    writeFileSync(testInfo.outputPath("frontier-proof.json"),JSON.stringify({synthetic:true,requests,waiting,refined},null,2));
  } finally {
    release();
    if(!page.isClosed()) await page.evaluate(()=>(window as unknown as {__frontier?:CinematicWorldEnginePort}).__frontier?.destroy());
  }
});
