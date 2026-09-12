import {describe,it,expect,vi} from "vitest";
import {Color,Group,Matrix4,Mesh,MeshBasicMaterial,PerspectiveCamera,PlaneGeometry,Scene,Vector2,Vector4,type WebGLRenderer} from "three";
import {TilesRenderer} from "3d-tiles-renderer/three";
import {LRUCache,type Tile} from "3d-tiles-renderer/core";
import type {QuestRoute} from "@/domain/route";
import {WorldFrame} from "./world-frame";
import {WorldSurfaceIndex} from "./world-surface";
import {WorldPreparedViews} from "./world-prepared-view";
import {worldFarPlane} from "./world-streaming";

function fixture() {
  const tiles=new TilesRenderer();tiles.lruCache=new LRUCache();
  const scene=new Scene();scene.add(tiles.group);
  const source=new Group(),mesh=new Mesh(new PlaneGeometry(12000,12000),new MeshBasicMaterial()),extras:Mesh[]=[];
  mesh.position.z=1000;source.add(mesh);tiles.group.add(source);scene.updateMatrixWorld(true);
  const tile={engineData:{scene:source},geometricError:2} as unknown as Tile;
  tiles.visibleTiles.add(tile);tiles.lruCache.add(tile,()=>{});tiles.lruCache.setMemoryUsage(tile,1000);
  vi.spyOn(tiles,"forEachLoadedModel").mockImplementation(callback=>callback(source,tile));
  const frame=new WorldFrame(51,-114),camera=new PerspectiveCamera();
  const pose={progressM:1000,center:{lat:51,lng:-114,altitude:1000},rangeM:1000,tiltDeg:0,headingDeg:0,fovDeg:50};
  frame.camera(camera,pose,1000);tiles.setCamera(camera);
  let coverage=.92,broadCoverage=.92;
  const compile=vi.fn(()=>Promise.resolve());
  const gpu={domElement:{clientWidth:960,clientHeight:640},getSize:(v:Vector2)=>v.set(960,640),
    getRenderTarget:()=>null,getViewport:(v:Vector4)=>v.set(0,0,960,640),getScissor:(v:Vector4)=>v.set(0,0,960,640),
    getScissorTest:()=>false,getClearColor:(v:Color)=>v.set(0),getClearAlpha:()=>1,setRenderTarget:vi.fn(),
    setViewport:vi.fn(),setScissor:vi.fn(),setScissorTest:vi.fn(),setClearColor:vi.fn(),render:vi.fn(),initTexture:vi.fn(),compileAsync:compile,
    readRenderTargetPixels:(_t:unknown,_x:number,_y:number,_w:number,_h:number,pixels:Uint8Array)=>{
      pixels.fill(0);
      const sample=(x:number,y:number,value:number)=>((x*37+y*19)%997)/997<value;
      for(let y=0;y<90;y++)for(let x=0;x<160;x++)if(sample(x,y,broadCoverage))pixels[(y*160+x)*4+3]=255;
      // The route-subject band can independently expose a central hole even if
      // surrounding terrain is present.
      for(let y=25;y<61;y++)for(let x=10;x<150;x++)pixels[(y*160+x)*4+3]=sample(x,y,coverage)?255:0;
    }} as unknown as WebGLRenderer;
  const manager=new WorldPreparedViews(tiles,frame,new WorldSurfaceIndex(new Matrix4()),gpu,scene,
    {elevationStatus:"recorded",provenance:{discontinuities:[]}} as unknown as QuestRoute,camera);
  return {tiles,scene,source,mesh,tile,manager,camera,pose,compile,setCoverage(v:number){coverage=v;broadCoverage=v;},setBroadCoverage(v:number){broadCoverage=v;},
    addOccluded(count:number){for(let i=0;i<count;i++){const extra=new Mesh(new PlaneGeometry(12000,12000),new MeshBasicMaterial());extra.position.z=900-i;source.add(extra);extras.push(extra);}scene.updateMatrixWorld(true);},
    dispose(){manager.dispose();tiles.lruCache.remove(tile);for(const item of [mesh,...extras]){item.geometry.dispose();(item.material as MeshBasicMaterial).dispose();}}};
}
describe("preparation convergence (simulated GPU readback)",()=>{
  it("does not freeze a manifest with a raster hole despite fifteen ray hits; it accepts later complete geometry",async()=>{
    const f=fixture(),now=performance.now();
    const result=f.manager.request(f.pose,{requestId:1,automatic:false,signal:new AbortController().signal},undefined);
    f.manager.update(now+1);f.manager.afterTraversal(now+1);
    expect(f.manager.report(now+1)).toMatchObject({manifestModels:0,reason:"coverage"});
    expect(f.manager.report(now+1).geometryCoverage).toBeCloseTo(.92,1);
    expect(f.compile).not.toHaveBeenCalled();expect(f.scene.overrideMaterial).toBeNull();
    f.setCoverage(1);f.manager.update(now+300);f.manager.afterTraversal(now+300);
    expect(f.manager.report(now+300).manifestModels).toBe(1);
    await Promise.resolve();await Promise.resolve();await Promise.resolve();
    for(const t of [600,900,1200]){f.manager.update(now+t);f.manager.afterTraversal(now+t);}
    expect(await result).toMatchObject({ready:true,requestId:1});
    expect(f.manager.commit(1)).toBe(true);expect(f.tiles.cameras).toContain(f.camera);f.dispose();
  });
  it("preserves the actual far plane and restores display traversal on cancellation",()=>{
    const f=fixture();f.setCoverage(1);const now=performance.now();
    void f.manager.request(f.pose,{requestId:2,automatic:false,signal:new AbortController().signal},undefined);
    f.manager.update(now+1);
    expect(f.manager.report(now+1).displayTraversalPaused).toBe(true);
    expect(f.tiles.cameras).not.toContain(f.camera);
    expect((f.tiles.cameras[0] as PerspectiveCamera).far).toBe(worldFarPlane(f.pose.rangeM));
    f.manager.cancel();expect(f.tiles.cameras).toContain(f.camera);
    expect(f.manager.report(now+2).displayTraversalPaused).toBe(false);f.dispose();
  });
  it("a synchronous compile failure releases its slot for the next attempt",async()=>{
    const f=fixture();f.setCoverage(1);const now=performance.now();
    f.compile.mockImplementationOnce(()=>{throw Error("compile rejected");});
    void f.manager.request(f.pose,{requestId:3,automatic:false,signal:new AbortController().signal},undefined);
    f.manager.update(now+1);f.manager.afterTraversal(now+1);
    f.manager.update(now+50);expect(f.compile).toHaveBeenCalledTimes(2);
    await Promise.resolve();await Promise.resolve();await Promise.resolve();f.dispose();
  });
  it("rebuilds an invalidated material cohort instead of waiting forever on a dead snapshot",async()=>{
    const f=fixture();f.setCoverage(1);const now=performance.now();
    const pending=f.manager.request(f.pose,{requestId:4,automatic:false,signal:new AbortController().signal});
    f.manager.update(now+1);f.manager.afterTraversal(now+1);
    expect(f.manager.report(now+1).manifestModels).toBe(1);
    f.manager.modelDisposed(f.source);
    // A refined replacement can reuse the scene identity; it still needs a new lease.
    f.manager.modelLoaded(f.source);
    await Promise.resolve();await Promise.resolve();await Promise.resolve();
    for(const t of [300,600,900,1200,1500]) {
      f.manager.update(now+t);f.manager.afterTraversal(now+t);
      await Promise.resolve();await Promise.resolve();await Promise.resolve();
    }
    expect(f.manager.report(now+1500).phase).toBe("ready");
    expect(await pending).toMatchObject({ready:true,requestId:4});f.dispose();
  });

  it("hands off after the visually critical materials are warm even when occluded manifest meshes remain",async()=>{
    const f=fixture();f.setCoverage(1);f.addOccluded(40);const now=performance.now();
    const pending=f.manager.request(f.pose,{requestId:5,automatic:false,signal:new AbortController().signal});
    f.manager.update(now+1);f.manager.afterTraversal(now+1);
    await Promise.resolve();await Promise.resolve();await Promise.resolve();
    for(const t of [300,600,900,1200]){f.manager.update(now+t);f.manager.afterTraversal(now+t);await Promise.resolve();await Promise.resolve();}
    const report=f.manager.report(now+1200);
    expect(report.manifestModels).toBeGreaterThan(report.criticalModels);
    expect(report.criticalModels).toBeGreaterThan(0);expect(report.criticalRemainingModels).toBe(0);
    expect(report.remainingModels).toBeGreaterThan(0);expect(report.phase).toBe("ready");
    expect(await pending).toMatchObject({ready:true,requestId:5});f.dispose();
  });

  it("does not hand off a close-looking center island while the wider landscape is still torn",async()=>{
    const f=fixture(),now=performance.now();f.setCoverage(1);f.setBroadCoverage(.55);
    const pending=f.manager.request(f.pose,{requestId:6,automatic:false,signal:new AbortController().signal});
    f.manager.update(now+1);f.manager.afterTraversal(now+1);
    const torn=f.manager.report(now+1);expect(torn.manifestModels).toBe(0);expect(torn.broadRasterCoverage).toBeLessThan(.82);expect(torn.reason).toBe("coverage");
    f.setBroadCoverage(1);
    for(const t of [300,600,900,1200,1500]){f.manager.update(now+t);f.manager.afterTraversal(now+t);await Promise.resolve();await Promise.resolve();await Promise.resolve();}
    expect(await pending).toMatchObject({ready:true,requestId:6});f.dispose();
  });

  it("lets a fully proven shot finish its temporal confirmation at the deadline instead of timing out first",async()=>{
    const f=fixture(),now=performance.now();f.setCoverage(1);
    let release!:()=>void;const compileGate=new Promise<void>(resolve=>release=resolve);f.compile.mockReturnValueOnce(compileGate);
    const pending=f.manager.request(f.pose,{requestId:7,automatic:false,signal:new AbortController().signal});
    f.manager.update(now+1);f.manager.afterTraversal(now+1);
    f.manager.update(now+26950);f.manager.afterTraversal(now+26950);
    release();await Promise.resolve();await Promise.resolve();await Promise.resolve();
    for(const t of [27200,27450,27700]){f.manager.update(now+t);f.manager.afterTraversal(now+t);await Promise.resolve();}
    expect(f.manager.report(now+27700).phase).toBe("ready");expect(await pending).toMatchObject({ready:true,requestId:7});f.dispose();
  });

  it("releases loading cameras at commit and accepts complete live replacement despite unrelated queued work",async()=>{
    const f=fixture(),now=performance.now();f.setCoverage(1);
    const pending=f.manager.request(f.pose,{requestId:8,automatic:false,signal:new AbortController().signal});
    for(const t of [1,300,600,900,1200]){f.manager.update(now+t);f.manager.afterTraversal(now+t);await Promise.resolve();await Promise.resolve();await Promise.resolve();}
    expect(await pending).toMatchObject({ready:true,requestId:8});expect(f.manager.commit(8)).toBe(true);
    expect(f.tiles.cameras).toEqual([f.camera]);
    Object.assign((f.tiles as TilesRenderer & {stats:{downloading:number;parsing:number}}).stats,{downloading:3,parsing:12});
    f.setCoverage(.70);f.manager.afterTraversal(now+3000);
    expect(f.manager.report(now+3000)).toMatchObject({phase:"transitioning",handoffShielded:true,handoffStableSamples:0,handoffPendingWork:15});
    // The queue stays busy: only current visible replacement coverage matters.
    f.setCoverage(1);
    for(const t of [3300,3550,3800,4050,4300,4550])f.manager.afterTraversal(now+t);
    expect(f.manager.report(now+4550).phase).toBe("arrived");f.dispose();
  });

});
