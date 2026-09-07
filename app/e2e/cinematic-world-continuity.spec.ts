import { expect, test } from "@playwright/test";
import { readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { syntheticCompressedGlb, syntheticRefiningTileset } from "./helpers/cinematic-fixture";
import type { CinematicWorldEnginePort } from "../src/surfaces/replay/world/cinematic-world-engine";
import type { WorldDiagnostics } from "../src/surfaces/replay/world/world-diagnostics";

test.use({launchOptions:{args:["--enable-unsafe-swiftshader"]}});

test("real terrain recovers after a missing destination without spending clear-sky cloud work", async ({page}, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({width:640,height:480});
  testInfo.annotations.push({type:"evidence", description:"Actual WebGL renderer, authored synthetic Draco terrain; NOT Google imagery acceptance."});
  const errors: string[]=[];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("https://tile.googleapis.com/**", async request => {
    const pathname = new URL(request.request().url()).pathname;
    if (pathname.includes("root.json")) await request.fulfill({json:syntheticRefiningTileset()});
    else if (pathname.endsWith("offscreen.glb")) await request.abort("failed");
    else await request.fulfill({contentType:"model/gltf-binary",body:syntheticCompressedGlb()});
  });
  await page.goto("/#/routes");
  const runtime=readdirSync(path.resolve("dist/assets")).find(name=>/^cinematic-world-engine-.*\.js$/.test(name));
  expect(runtime).toBeTruthy();
  await page.evaluate(async url => {
    const module = await import(/* @vite-ignore */ url);
    const engine: CinematicWorldEnginePort = module.createCinematicWorldEngine();
    const container=document.createElement("div");
    container.id="continuity-fixture";
    container.style.cssText="position:fixed;inset:0;z-index:100;--world-dock-height:0px";
    document.body.append(container);
    (window as unknown as {__continuity: CinematicWorldEnginePort}).__continuity=engine;
    engine.setEnvironment({light:"daylight",clouds:0,labels:false,quality:"balanced",reducedMotion:true});
    // The fixture exposes its actual instance for lifecycle testing, never a replacement renderer.
    await engine.mount({apiKey:"synthetic-credential-only",container,groundingMode:"mesh",
      initialCamera:{center:{lat:51,lng:-114,altitude:1000},headingDeg:0,rangeM:179,tiltDeg:65,fovDeg:50,progressM:0},
      route: {slug:"synthetic-continuity",name:"Synthetic terrain continuity",lifecycle:"completed",distanceKm:2,centerLat:51,centerLng:-114,elevationStatus:"recorded",
        replay:{replayEligible:true,geometryStatus:"ready"},route:[{lat:51,lng:-114.01,elev:1000,d:0},{lat:51,lng:-114,elev:1000,d:1000},{lat:51,lng:-113.99,elev:1000,d:2000}],provenance:{discontinuities:[],elevation:{status:"recorded"}}} as never,
      onStatus:status => {container.dataset.engineStatus=status.state;container.dataset.message=status.message;},
    });
    engine.setPlaybackContext?.({playing:true,following:true,progressM:1000,speed:1,cameraMode:"runner",groundingMode:"mesh",rangeScale:1,cameraSettling:false,settingsOpen:false,reducedMotion:true});
    engine.setCinematicRoute({focusRatio:0.5,startRatio:0,endRatio:1,rangeM:179,motionIntensity:1,shotKind:"tracking"});
    const caption=document.createElement("div");caption.textContent="SYNTHETIC CONTINUITY TEST — NOT LIVE IMAGERY";
    caption.style.cssText="position:absolute;top:8px;left:8px;background:white;color:#111;padding:8px;font:12px Arial";
    container.append(caption);
  },`/assets/${runtime}`);
  const world=page.locator("#continuity-fixture");
  const read=()=>page.evaluate(() => {const detail={report:null};document.querySelector("#continuity-fixture")!.dispatchEvent(new CustomEvent("godiesel:world-diagnostics",{detail}));return detail.report as unknown as WorldDiagnostics;});
  await expect(world).toHaveAttribute("data-world-view",/ready|refining/,{timeout:30_000});
  await expect(world).toHaveAttribute("data-world-atmosphere","ready",{timeout:30_000});
  expect((await read()).quality.cloudPassSubmissions).toBe(0);
  await page.screenshot({path:testInfo.outputPath("01-synthetic-close-landscape.png")});
  // Move beyond the authored tile: historical startup readiness is not current coverage.
  await page.evaluate(() => {
    const engine=(window as unknown as {__continuity:CinematicWorldEnginePort}).__continuity;
    engine.setCamera({center:{lat:52,lng:-114,altitude:1000},headingDeg:0,rangeM:179,tiltDeg:65,fovDeg:50,progressM:1000});
  });
  await expect(world).toHaveAttribute("data-world-view","missing");
  await expect(world).toHaveAttribute("data-world-buffering","true");
  await expect(world).toHaveAttribute("data-engine-status","partial");
  await expect(world).toHaveAttribute("data-message",/Holding this moment/);
  const missing=await read();
  expect(missing.terrain.view?.buffering).toBe(true);
  // Return through a burst of real camera updates, ending at an already loaded destination.
  await page.evaluate(() => {
    const engine=(window as unknown as {__continuity:CinematicWorldEnginePort}).__continuity;
    for(let i=0;i<40;i++) {
      engine.setPlaybackContext?.({playing:true,following:true,progressM:900+i*2.5,speed:1,cameraMode:"runner",groundingMode:"mesh",rangeScale:1,cameraSettling:true,settingsOpen:false,reducedMotion:true},"seek");
    }
    engine.setCamera({center:{lat:51,lng:-114,altitude:1000},headingDeg:0,rangeM:179,tiltDeg:65,fovDeg:50,progressM:1000});
    engine.setEnvironment({light:"golden",clouds:0,labels:false,quality:"cinema",reducedMotion:true});
  });
  await expect(world).toHaveAttribute("data-world-view",/ready|refining/);
  await expect(world).toHaveAttribute("data-world-buffering","false");
  const recovered=await read();
  expect(recovered.quality.cloudPassSubmissions).toBe(0); // Cinema without clouds has zero shadow/volume work too.
  expect(recovered.terrain.streaming?.pendingLimit).toBe(24);
  expect(recovered.events.entries.filter(event=>event.kind==="seek")).toHaveLength(1);
  expect(recovered.events.entries.find(event=>event.kind==="seek")?.scrub?.updates).toBe(40);
  expect(recovered.terrain.view?.coverage.centerHit).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({path:testInfo.outputPath("02-synthetic-recovered-cinema.png")});
  writeFileSync(testInfo.outputPath("continuity-evidence.json"),JSON.stringify({synthetic:true,missing,recovered},null,2));
  await page.evaluate(()=>(window as unknown as {__continuity:CinematicWorldEnginePort}).__continuity.destroy());
  await expect(world.locator("canvas")).toHaveCount(0);
});
