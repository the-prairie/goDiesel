import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import { planWorldGapAcquisition } from "./world-gap-acquisition";
import type { WorldRasterCoverage } from "./world-raster-coverage";
function camera(){const c=new PerspectiveCamera(50,16/9,.5,20000);c.position.set(0,0,200);c.lookAt(0,0,0);c.updateMatrixWorld();c.up.set(0,0,1);return c;}
const mask=(samples:WorldRasterCoverage["missingGroundSamples"])=>({missingGroundSamples:samples}) as WorldRasterCoverage;
describe("gap-directed loading interests",()=>{
 it("requests at most four finite columns and never changes the subject or camera",()=>{
  const c=camera(),position=c.position.clone(),subject=new Vector3();
  const plan=planWorldGapAcquisition(mask(Array.from({length:20},(_,i)=>({xNdc:(i%3-1)*.5,yNdc:0,missingPixels:100}))),c,subject,720,10);
  expect(plan).toHaveLength(4);expect(c.position).toEqual(position);expect(subject).toEqual(new Vector3());
  for(const item of plan){expect(item.position.z).toBeCloseTo(0);expect(item.radiusM).toBeLessThanOrEqual(220);expect(item.errorTargetM).toBeGreaterThanOrEqual(2);}
 });
 it("does not request a distant or above-horizon destination",()=>{
  const c=camera();c.up.set(0,1,0);c.lookAt(0,0,0);c.updateMatrixWorld();
  expect(planWorldGapAcquisition(mask([{xNdc:0,yNdc:.8,missingPixels:100}]),c,new Vector3(0,-100,0),720,10)).toEqual([]);
  c.far=100;expect(planWorldGapAcquisition(mask([{xNdc:0,yNdc:-.1,missingPixels:100}]),c,new Vector3(0,-100,0),720,10)).toEqual([]);
 });
 it("scales geometric error from the actual pixel target, not a fixed ten metres",()=>{
  const c=camera(),m=mask([{xNdc:0,yNdc:0,missingPixels:100}]);
  const fine=planWorldGapAcquisition(m,c,new Vector3(),720,10)[0];
  const coarse=planWorldGapAcquisition(m,c,new Vector3(),720,16)[0];
  expect(coarse.errorTargetM).toBeGreaterThan(fine.errorTargetM);expect(fine.errorTargetM).toBeLessThan(10);
 });
});
