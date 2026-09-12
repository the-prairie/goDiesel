import { test, expect } from "@playwright/test";
import { build } from "vite";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";

test.use({launchOptions:{args:["--enable-unsafe-swiftshader"]}});
test("real WebGL keeps fine terrain visible while retained terrain fills holes in daylight and HDR atmosphere buffers",async({page},info)=>{
  test.setTimeout(60_000);
  // Bundle the real compositor and installed rendering dependencies, not a mock renderer.
  const output=await build({configFile:false,logLevel:"error",build:{write:false,minify:false,
    lib:{entry:resolve("e2e/helpers/terrain-composite-harness.ts"),name:"TerrainCompositeProof",formats:["iife"]}}});
  const bundles=Array.isArray(output)?output:[output];
  const code=bundles.flatMap(b=>"output" in b?b.output:[]).find(o=>o.type==="chunk");
  if(!code||code.type!=="chunk")throw Error("Missing compositor harness bundle");
  await page.goto("about:blank");await page.addScriptTag({content:code.code});
  const result=await page.evaluate(()=> (window as unknown as {TerrainCompositeProof:{verifyTerrainComposite:()=>unknown}}).TerrainCompositeProof.verifyTerrainComposite());
  const r=result as {direct:number[][];atmosphereBuffer:number[][];replacement:number[][];recovered:number[][];restored:boolean};
  for(const samples of [r.direct,r.atmosphereBuffer])expect(samples).toEqual([[0,255,0],[0,0,255],[255,0,0]]);
  expect(r.replacement).toEqual([[0,255,0],[0,0,255],[0,255,0]]);
  expect(r.recovered).toEqual([[255,0,0],[0,0,255],[255,0,0]]);expect(r.restored).toBe(true);
  writeFileSync(info.outputPath("real-webgl-compositor-proof.json"),JSON.stringify(result,null,2));
});
