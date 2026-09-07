import { AgXToneMapping, Box3, Color, Frustum, Matrix4, Mesh, PerspectiveCamera, Texture, Vector3, Vector4, WebGLRenderTarget, type Object3D, type Scene, type WebGLRenderer } from "three";
import type { TilesRenderer } from "3d-tiles-renderer/three";
import { LoadRegionPlugin, SphereRegion } from "3d-tiles-renderer/three/plugins";
import type { QuestRoute } from "@/domain/route";
import type { GoogleRouteCameraPose } from "../playback/route-navigator-controller";
import type { ReplayPreparedView, ReplayPreparationReason, ReplayViewRequestOptions } from "../playback/replay-view-handoff";
import { WorldFrame } from "./world-frame";
import { WorldSurfaceIndex } from "./world-surface";
import { solveWorldCamera, type WorldCameraSolution } from "./world-camera-solution";
import { sampleWorldView } from "./world-view-health";

class SubjectRegion extends SphereRegion {
  override calculateDistance(volume: { distanceToPoint(point: Vector3): number }) { return volume.distanceToPoint(this.sphere.center); }
}
export interface PreparedViewReport {
  phase: "idle" | "preparing" | "ready" | "transitioning" | "arrived" | "blocked" | "warming";
  requestId: number | null;
  selectedProgressM: number | null;
  preparationMs: number;
  reason: ReplayPreparationReason | null;
  candidateCameras: number;
  coverage: number;
  rasterCoverage: number;
  stableSamples: number;
  compiledModels: number;
  completed: number;
  cancelled: number;
  blocked: number;
  recentPreparationsMs: number[];
}
interface Candidate { pose: GoogleRouteCameraPose; camera: PerspectiveCamera; target: SubjectRegion; support: SubjectRegion; solution?: WorldCameraSolution; models?: Object3D[]; }
interface Preparation {
  options: ReplayViewRequestOptions;
  candidates: Candidate[];
  pose: GoogleRouteCameraPose;
  startedAt: number;
  deadline: number;
  stableSamples: number;
  ready: boolean;
  warming: boolean;
  resolve: (result: ReplayPreparedView) => void;
  abort: () => void;
  releaseAt: number | null;
}
const copyPose = (pose: GoogleRouteCameraPose) => ({ ...pose, center: { ...pose.center } });
/** Short local camera moves get intermediate checks; distant seeks never fly through unverified land. */
export function preparedCameraPath(from: GoogleRouteCameraPose | undefined, to: GoogleRouteCameraPose, route: QuestRoute) {
  const gap = from && route.provenance.discontinuities.some(d => Math.max(from.progressM,to.progressM) >= d.startD && Math.min(from.progressM,to.progressM) <= d.endD);
  if (!from || gap || Math.abs(from.progressM-to.progressM)>250 || from.rangeM>1500 || to.rangeM>1500) return [copyPose(to)];
  const heading = ((to.headingDeg-from.headingDeg+540)%360)-180;
  // Two intermediate positions and the endpoint; never interpolate a route trace.
  return [0.33,0.66,1].map(t => ({...to, center: {
    lat: from.center.lat+(to.center.lat-from.center.lat)*t,
    lng: from.center.lng+(((to.center.lng-from.center.lng+540)%360)-180)*t,
    ...(to.center.altitude === undefined ? {} : {altitude:(from.center.altitude ?? to.center.altitude)+(to.center.altitude-(from.center.altitude ?? to.center.altitude))*t}),
  }, headingDeg:from.headingDeg+heading*t,rangeM:from.rangeM+(to.rangeM-from.rangeM)*t,tiltDeg:from.tiltDeg+(to.tiltDeg-from.tiltDeg)*t,
    fovDeg:from.fovDeg+(to.fovDeg-from.fovDeg)*t,progressM:from.progressM+(to.progressM-from.progressM)*t }));
}

/**
 * Prepare actual provider geometry in the SAME cache and renderer. At most three
 * short-range preparation cameras and six bounded, non-masking support regions.
 * Their data is not the displayed view; no offscreen draw advances transport or
 * increments the main renderer's recorded terrain submissions.
 */
export class WorldPreparedViews {
  private readonly regions = new LoadRegionPlugin();
  private active?: Preparation;
  private readonly compiled = new WeakSet<Object3D>();
  private readonly compiling = new WeakSet<Object3D>();
  private readonly alive = new Set<Object3D>();
  private inFlight = 0;
  private closed = false;
  private nextCheck = 0;
  private readonly target = new WebGLRenderTarget(160,90);
  private readonly pixels = new Uint8Array(160*90*4);
  private reportValue: PreparedViewReport = {phase:"idle",requestId:null,selectedProgressM:null,preparationMs:0,reason:null,candidateCameras:0,coverage:0,rasterCoverage:0,stableSamples:0,compiledModels:0,completed:0,cancelled:0,blocked:0,recentPreparationsMs:[]};
  constructor(private readonly tiles: TilesRenderer, private readonly frame: WorldFrame, private readonly surfaces: WorldSurfaceIndex,
    private readonly renderer: WebGLRenderer, private readonly scene: Scene, private readonly route: QuestRoute) {
    tiles.registerPlugin(this.regions);
    tiles.forEachLoadedModel(model=>this.alive.add(model));
  }
  modelLoaded(model: Object3D) { this.alive.add(model); }
  modelDisposed(model: Object3D) { this.alive.delete(model); this.compiled.delete(model); }
  get busy() { return Boolean(this.active && !this.active.warming); }
  report(now: number): PreparedViewReport {
    return {...this.reportValue, preparationMs:this.active && !this.active.ready ? Math.max(0,now-this.active.startedAt) : this.reportValue.preparationMs,
      recentPreparationsMs:[...this.reportValue.recentPreparationsMs]};
  }
  request(pose: GoogleRouteCameraPose, options: ReplayViewRequestOptions, from?: GoogleRouteCameraPose, warming=false): Promise<ReplayPreparedView> {
    this.cancel();
    if (this.closed || options.signal.aborted) return Promise.reject(new DOMException("Preparation cancelled","AbortError"));
    const startedAt=performance.now();
    const candidates=preparedCameraPath(warming ? undefined : from,pose,this.route).map(p=>{
      const camera=new PerspectiveCamera(p.fovDeg,this.renderer.domElement.clientWidth/Math.max(1,this.renderer.domElement.clientHeight),.5,20000);
      this.tiles.setCamera(camera);this.tiles.setResolutionFromRenderer(camera,this.renderer);
      const target=new SubjectRegion({errorTarget:2}),support=new SubjectRegion({errorTarget:2});
      this.regions.addRegion(target);this.regions.addRegion(support);
      return {pose:p,camera,target,support};
    });
    this.reportValue={...this.reportValue,phase:warming?"warming":"preparing",requestId:options.requestId,selectedProgressM:pose.progressM,
      preparationMs:0,reason:"surface",candidateCameras:candidates.length,coverage:0,rasterCoverage:0,stableSamples:0};
    const promise=new Promise<ReplayPreparedView>(resolve=>{
      const abort=()=>this.cancel();
      this.active={pose:copyPose(pose),options,candidates,startedAt,deadline:startedAt+(warming?5000:27000),stableSamples:0,ready:false,warming,resolve,abort,releaseAt:null};
      options.signal.addEventListener("abort",abort,{once:true});
    });
    this.nextCheck=0;this.updateCameras();return promise;
  }
  private updateCameras() {
    const active=this.active;if(!active)return;
    for(const c of active.candidates) {
      c.camera.aspect=this.renderer.domElement.clientWidth/Math.max(1,this.renderer.domElement.clientHeight);
      c.solution=solveWorldCamera(this.frame,this.surfaces,c.pose,c.camera,this.route.elevationStatus!=="unavailable");
      // Prepare the near scene, not a second 20-km horizon for every candidate.
      c.camera.far=Math.min(c.camera.far,Math.max(2500,c.pose.rangeM*4));c.camera.updateProjectionMatrix();
      this.tiles.setResolutionFromRenderer(c.camera,this.renderer);
      if(this.route.elevationStatus!=="unavailable" && c.pose.rangeM<=2500) {
        c.target.sphere.center.copy(this.frame.position(c.pose.center.lat,c.pose.center.lng,c.pose.center.altitude ?? 0)).applyMatrix4(this.frame.worldToECEF);
        c.target.sphere.radius=180;
        const up=this.frame.normal(c.pose.center.lat,c.pose.center.lng);
        c.support.sphere.center.copy(c.camera.position).addScaledVector(up,(c.pose.center.altitude ?? 0)+c.solution.targetCorrectionM-this.frame.height(c.camera.position)).applyMatrix4(this.frame.worldToECEF);
        c.support.sphere.radius=140;
      } else { c.target.sphere.radius=-1;c.support.sphere.radius=-1; }
    }
  }
  /** Called before tiles.update so selection is aimed at the actual corrected candidates. */
  update(now: number) {
    const active=this.active;if(!active)return;
    if(active.releaseAt!==null) {if(now>=active.releaseAt)this.release("arrived");return;}
    if(now>=active.deadline && !active.ready) {
      this.reportValue.blocked+=active.warming?0:1;this.reportValue.preparationMs=now-active.startedAt;
      active.resolve({ready:false,requestId:active.options.requestId,reason:"timeout",transition:"cut",preparationMs:now-active.startedAt});
      this.release(active.warming?"idle":"blocked");return;
    }
    if(now>=this.nextCheck && !active.ready) this.updateCameras();
    // Readiness probes are sparse; prewarming progresses every display frame.
    // Two asynchronous model jobs in flight still bound uploads/compilation.
    if(!active.ready)for(const c of active.candidates)if(c.models)this.warm(c.models,c.camera);
  }
  /** Shader/texture prewarming is incremental and bounded to two models in flight. */
  private warm(models: Object3D[], camera: PerspectiveCamera) {
    for(const model of models) {
      if(this.inFlight>=2)break;
      if(this.compiled.has(model)||this.compiling.has(model)||!this.alive.has(model))continue;
      this.compiling.add(model);this.inFlight++;
      try {
        const textures=new Set<Texture>();
        model.traverse(object=>{if(object instanceof Mesh)for(const material of Array.isArray(object.material)?object.material:[object.material])
          for(const value of Object.values(material))if(value instanceof Texture)textures.add(value);});
        for(const texture of textures)this.renderer.initTexture(texture);
        void this.renderer.compileAsync(model,camera,this.scene).then(()=>{
          if(!this.closed&&this.alive.has(model)){this.compiled.add(model);this.reportValue.compiledModels++;}
        }).catch(()=>{}).finally(()=>{this.compiling.delete(model);this.inFlight--;});
      } catch {this.compiling.delete(model);this.inFlight--;}
    }
  }
  private relevantModels(camera: PerspectiveCamera) {
    const frustum=new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
    const models:Object3D[]=[];
    this.tiles.forEachLoadedModel((model,tile)=>{
      if(this.tiles.visibleTiles.has(tile)&&frustum.intersectsBox(new Box3().setFromObject(model)))models.push(model);
    });
    return models;
  }
  /** Tiny real-material raster probe; only terrain, no HUD/labels/route able to fake coverage. */
  private rasterCoverage(camera: PerspectiveCamera) {
    const r=this.renderer, oldTarget=r.getRenderTarget(),viewport=r.getViewport(new Vector4()),scissor=r.getScissor(new Vector4()),scissorTest=r.getScissorTest();
    const color=r.getClearColor(new Color()),alpha=r.getClearAlpha(),tone=r.toneMapping,autoClear=r.autoClear;
    const visibility=[...this.scene.children,...this.tiles.group.children].map(child=>[child,child.visible] as const);
    try {
      for(const child of this.scene.children)child.visible=child===this.tiles.group;
      for(const child of this.tiles.group.children)child.visible=this.alive.has(child) && child.visible;
      r.toneMapping=AgXToneMapping;r.autoClear=true;r.setRenderTarget(this.target);r.setScissorTest(false);r.setClearColor(color,0);
      r.render(this.scene,camera);r.readRenderTargetPixels(this.target,0,0,160,90,this.pixels);
      let filled=0,total=0;
      // WebGL rows start at the bottom. Evaluate the lower/middle ground band;
      // this is geometry/material coverage, NOT a universal beauty classifier.
      for(let y=25;y<61;y++)for(let x=10;x<150;x++){total++;if(this.pixels[(y*160+x)*4+3]>240)filled++;}
      return filled/total;
    } finally {
      for(const [child,visible]of visibility)child.visible=visible;
      r.toneMapping=tone;r.autoClear=autoClear;r.setClearColor(color,alpha);r.setRenderTarget(oldTarget);r.setViewport(viewport);r.setScissor(scissor);r.setScissorTest(scissorTest);
    }
  }
  afterTraversal(now: number) {
    const a=this.active;if(!a||a.ready||now<this.nextCheck)return;
    this.nextCheck=now+200;
    let reason:ReplayPreparationReason|undefined,coverage=1,raster=1;
    for(const c of a.candidates) {
      const s=c.solution!;const close=c.pose.rangeM<=800;
      if(close&&(s.targetErrorM===null||s.targetErrorM>8||s.clearanceM===null||s.clearanceM<17.9)) {reason="surface";break;}
      if(close&&s.sightline!=="clear"){reason="sightline";break;}
      const view=sampleWorldView(this.tiles,c.camera,now);
      coverage=Math.min(coverage,view.tested?view.hits/view.tested:0);
      if(!view.centerHit||coverage<.93){reason="coverage";break;}
      const models=this.relevantModels(c.camera);c.models=models;this.warm(models,c.camera);
      if(!models.length||models.some(model=>!this.compiled.has(model))){reason="materials";break;}
      raster=Math.min(raster,this.rasterCoverage(c.camera));
      if(raster<.94){reason="coverage";break;}
    }
    a.stableSamples=reason?0:a.stableSamples+1;
    Object.assign(this.reportValue,{coverage,rasterCoverage:raster,reason:reason??null,stableSamples:a.stableSamples});
    if(a.stableSamples>=3) {
      a.ready=true;this.reportValue.phase=a.warming?"warming":"ready";this.reportValue.preparationMs=now-a.startedAt;
      a.resolve({ready:true,requestId:a.options.requestId,transition:a.candidates.length>1?"flight":"cut",preparationMs:now-a.startedAt});
      if(a.warming)a.releaseAt=now+1000;
    }
  }
  commit(requestId: number) {
    const a=this.active;if(!a||!a.ready||a.options.requestId!==requestId||a.options.signal.aborted)return false;
    a.options.signal.removeEventListener("abort",a.abort);
    a.releaseAt=performance.now()+1200;this.reportValue.phase="transitioning";this.reportValue.completed++;
    this.reportValue.recentPreparationsMs.push(this.reportValue.preparationMs);
    if(this.reportValue.recentPreparationsMs.length>12)this.reportValue.recentPreparationsMs.shift();
    return true;
  }
  private release(phase: PreparedViewReport["phase"]) {
    const a=this.active;if(!a)return;
    a.options.signal.removeEventListener("abort",a.abort);
    for(const c of a.candidates){this.tiles.deleteCamera(c.camera);this.regions.removeRegion(c.target);this.regions.removeRegion(c.support);}
    this.active=undefined;this.reportValue.phase=phase;this.reportValue.candidateCameras=0;
  }
  cancel() {
    const a=this.active;if(!a)return;
    if(!a.ready){a.resolve({ready:false,requestId:a.options.requestId,reason:"unavailable",transition:"cut",preparationMs:performance.now()-a.startedAt});if(!a.warming)this.reportValue.cancelled++;}
    this.release("idle");
  }
  dispose(){this.closed=true;this.cancel();this.tiles.unregisterPlugin(this.regions);this.target.dispose();this.alive.clear();}
}
