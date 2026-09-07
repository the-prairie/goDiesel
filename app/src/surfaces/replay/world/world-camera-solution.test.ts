import {describe,it,expect} from "vitest";
import {Group,Mesh,MeshBasicMaterial,PlaneGeometry,PerspectiveCamera,DoubleSide,Vector3} from "three";
import {WorldFrame} from "./world-frame";
import {WorldSurfaceIndex} from "./world-surface";
import {solveWorldCamera} from "./world-camera-solution";
const pose={center:{lat:0,lng:0,altitude:100},rangeM:180,tiltDeg:65,headingDeg:0,fovDeg:50,progressM:0};
function setup(wall=false){
 const frame=new WorldFrame(0,0),index=new WorldSurfaceIndex(frame.ecefToWorld),scene=new Group();scene.matrixAutoUpdate=false;scene.matrix.copy(frame.worldToECEF);
 const material=new MeshBasicMaterial({side:DoubleSide});const ground=new Mesh(new PlaneGeometry(4000,4000),material);ground.position.z=100;scene.add(ground);
 if(wall){const obstacle=new Mesh(new PlaneGeometry(500,140),material);obstacle.rotation.x=Math.PI/2;obstacle.position.set(0,-90,170);scene.add(obstacle);}
 index.add(scene,2);
 return {frame,index,dispose:()=>{scene.traverse(o=>{if(o instanceof Mesh)o.geometry.dispose();});material.dispose();}};
}
describe("route-subject camera solution",()=>{
 it("keeps an unobstructed requested camera and qualifies the actual ground",()=>{
 const s=setup(),camera=new PerspectiveCamera();const result=solveWorldCamera(s.frame,s.index,pose,camera,true);
 expect(result.sightline).toBe("clear");expect(result.targetErrorM).toBe(2);expect(Math.abs(result.targetCorrectionM)).toBeLessThan(.01);expect(result.clearanceM).toBeGreaterThan(18);expect(result.liftM).toBeCloseTo(0);s.dispose();
 });
 it("does not confuse clearance below the lens with a clear view through a hillside",()=>{
 const s=setup(true),camera=new PerspectiveCamera();const result=solveWorldCamera(s.frame,s.index,pose,camera,true);
 expect(result.liftM).toBeGreaterThan(0);expect(result.sightline).toBe("clear");expect(camera.position.distanceTo(result.target)).toBeLessThan(600);expect(pose.center.altitude).toBe(100);s.dispose();
 });
 it("leaves missing surface measurements unknown rather than inventing readiness",()=>{
 const frame=new WorldFrame(0,0);const result=solveWorldCamera(frame,new WorldSurfaceIndex(frame.ecefToWorld),pose,new PerspectiveCamera(),true);
 expect(result.clearanceM).toBeNull();expect(result.targetErrorM).toBeNull();expect(result.sightline).toBe("unknown");expect(result.targetCorrectionM).toBe(0);
 });
 it("tests the nearest obstacle instead of selecting a finer surface behind it",()=>{
 const s=setup(true);expect(s.index.obstruction(new Vector3(0,-150,170),new Vector3(0,0,102),3)).not.toBeNull();s.dispose();
 });
});
