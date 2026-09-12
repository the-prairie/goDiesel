import { describe, expect, it } from "vitest";
import { PerspectiveCamera } from "three";
import { measureWorldRaster } from "./world-raster-coverage";
function fixture() {
  const camera = new PerspectiveCamera(50, 16/9, .5, 20000);
  camera.position.set(0, 0, 200); camera.up.set(0, 1, 0); camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  // Deliberate overhead camera, local ground normal along Z.
  camera.up.set(0, 0, 1);
  const pixels = new Uint8Array(160*90*4); pixels.fill(255);
  return { camera, pixels, measure: () => measureWorldRaster(pixels,160,90,camera) };
}
describe("terrain-only ground coverage", () => {
  it("rejects upper landscape tears even when the old subject band is completely filled", () => {
    const f=fixture();
    for(let y=65;y<85;y++)for(let x=40;x<115;x++)f.pixels[(y*160+x)*4+3]=0;
    const result=f.measure();
    expect(result.ground).toBe(1);expect(result.broad).toBeGreaterThan(.82);
    expect(result.usable).toBe(false);expect(result.largestHoleFraction).toBeGreaterThan(.1);
  });
  it("rejects a localized hole that still has more than 98 percent average coverage", () => {
    const f=fixture();
    for(let y=31;y<43;y++)for(let x=62;x<76;x++)f.pixels[(y*160+x)*4+3]=0;
    const result=f.measure();expect(result.groundCoverage).toBeGreaterThan(.98);
    expect(result.usable).toBe(false);
  });
  it("accepts full ground and sparse raster edge noise", () => {
    const f=fixture();expect(f.measure().usable).toBe(true);
    for(let y=5;y<85;y+=12)for(let x=5;x<155;x+=12)f.pixels[(y*160+x)*4+3]=0;
    expect(f.measure().usable).toBe(true);
  });
  it("does not mistake intentional sky for missing terrain", () => {
    const f=fixture();f.camera.up.set(0,1,0);f.camera.lookAt(0,-15,0);f.camera.updateMatrixWorld();
    // Pixels above the projected horizon are sky. Clear a safely above-horizon band.
    for(let y=65;y<90;y++)for(let x=0;x<160;x++)f.pixels[(y*160+x)*4+3]=0;
    expect(f.measure().usable).toBe(true);
  });
  it("fails closed for an empty raster and validates its dimensions", () => {
    const f=fixture();f.pixels.fill(0);expect(f.measure().usable).toBe(false);
    expect(()=>measureWorldRaster(new Uint8Array(3),160,90,f.camera)).toThrow(RangeError);
  });
});
