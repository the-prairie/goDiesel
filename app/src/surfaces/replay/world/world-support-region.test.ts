import { describe,it,expect } from "vitest";
import { Vector3 } from "three";
import { WorldFrame } from "./world-frame";
import { WorldSupportRegion } from "./world-support-region";
describe("bounded camera-support column",()=>{
  it("requests elevated slopes without expanding the horizontal footprint",()=>{
    const frame=new WorldFrame(51,-114),region=new WorldSupportRegion(2),position=new Vector3(100,50,1000);
    region.locate(frame,position,90);
    expect(region.obb.containsPoint(new Vector3(100,50,1700).applyMatrix4(frame.worldToECEF))).toBe(true);
    expect(region.obb.containsPoint(new Vector3(300,50,1000).applyMatrix4(frame.worldToECEF))).toBe(false);
    expect(region.obb.containsPoint(new Vector3(100,50,2600).applyMatrix4(frame.worldToECEF))).toBe(false);
    expect(region.errorTarget).toBe(2);expect(region.mask).toBe(false);
  });
});
