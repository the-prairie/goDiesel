import { WorldPreparationPriority } from "./world-preparation-priority";
import { AgXToneMapping, Color, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Texture, Vector4, WebGLRenderTarget, type Object3D, type Scene, type WebGLRenderer } from "three";
import type { TilesRenderer } from "3d-tiles-renderer/three";
import { LoadRegionPlugin } from "3d-tiles-renderer/three/plugins";
import { WorldSupportRegion } from "./world-support-region";
import { WorldTerrainSnapshot } from "./world-terrain-snapshot";
import type { QuestRoute } from "@/domain/route";
import type { GoogleRouteCameraPose } from "../playback/route-navigator-controller";
import type { ReplayPreparedView, ReplayPreparationReason, ReplayViewRequestOptions } from "../playback/replay-view-handoff";
import { WorldFrame } from "./world-frame";
import { WorldSurfaceIndex } from "./world-surface";
import { solveWorldCamera, type WorldCameraSolution } from "./world-camera-solution";
import { sampleWorldMeshes, sampleWorldView } from "./world-view-health";
import { collectWorldVisualCriticalMeshes } from "./world-visual-critical";

export interface PreparedViewReport {
  phase: "idle" | "preparing" | "ready" | "transitioning" | "arrived" | "blocked" | "warming";
  requestId: number | null;
  selectedProgressM: number | null;
  preparationMs: number;
  reason: ReplayPreparationReason | null;
  candidateCameras: number;
  coverage: number;
  rasterCoverage: number;
  broadRasterCoverage: number;
  stableSamples: number;
  compiledModels: number;
  completed: number;
  cancelled: number;
  blocked: number;
  recentPreparationsMs: number[];
  manifestModels: number;
  remainingModels: number;
  retainedDisplayModels: number;
  pinnedBytes: number;
  geometryCoverage: number;
  displayTraversalPaused: boolean;
  cohortRestarts: number;
  materialFailures: number;
  warmInFlight: number;
  criticalModels: number;
  criticalRemainingModels: number;
  handoffShielded: boolean;
  handoffStableSamples: number;
  handoffPendingWork: number;
  candidates: Array<{targetErrorM: number | null; clearanceM: number | null; frozen: boolean; rangeM?: number; heightM?: number; liftM?: number; targetAvailableErrorM?: number | null; cameraAvailableErrorM?: number | null}>;
}
interface Candidate {
  pose: GoogleRouteCameraPose;
  camera: PerspectiveCamera;
  target: WorldSupportRegion;
  support: WorldSupportRegion;
  focus?: WorldSupportRegion;
  focusActive?: boolean;
  solution?: WorldCameraSolution;
  snapshot?: WorldTerrainSnapshot;
  critical?: Mesh[];
}
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
const PREPARATION_DEADLINE_MS = 27_000;
const PREPARATION_PROOF_GRACE_MS = 900;
const HANDOFF_MIN_RESIDENCY_MS = 1_200;
const HANDOFF_PENDING_LIMIT = 6;
const HANDOFF_STABLE_SAMPLES = 6;
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
  private readonly priority: WorldPreparationPriority;
  private active?: Preparation;
  private readonly compiled = new WeakSet<Object3D>();
  private readonly alive = new Set<Object3D>();
  private inFlight = 0;
  private displayTraversalPaused = false;
  private readonly silhouetteMaterial = new MeshBasicMaterial();
  private releaseSamples = 0;
  private outgoing?: WorldTerrainSnapshot;
  private display?: WorldTerrainSnapshot;
  private readonly pinnedLimit = 288 * 1024 * 1024;
  private closed = false;
  private nextCheck = 0;
  private readonly target = new WebGLRenderTarget(160,90);
  private readonly pixels = new Uint8Array(160*90*4);
  private reportValue: PreparedViewReport = {phase:"idle",requestId:null,selectedProgressM:null,preparationMs:0,reason:null,candidateCameras:0,coverage:0,rasterCoverage:0,broadRasterCoverage:0,stableSamples:0,compiledModels:0,completed:0,cancelled:0,blocked:0,recentPreparationsMs:[],manifestModels:0,remainingModels:0,retainedDisplayModels:0,pinnedBytes:0,geometryCoverage:0,displayTraversalPaused:false,cohortRestarts:0,materialFailures:0,warmInFlight:0,criticalModels:0,criticalRemainingModels:0,handoffShielded:false,handoffStableSamples:0,handoffPendingWork:0,candidates:[]};
  constructor(private readonly tiles: TilesRenderer, private readonly frame: WorldFrame, private readonly surfaces: WorldSurfaceIndex,
    private readonly renderer: WebGLRenderer, private readonly scene: Scene, private readonly route: QuestRoute, private readonly displayCamera: PerspectiveCamera) {
    this.priority = new WorldPreparationPriority(tiles);
    tiles.registerPlugin(this.regions);
    tiles.forEachLoadedModel(model=>this.alive.add(model));
  }
  modelLoaded(model: Object3D) { this.alive.add(model); }
  modelDisposed(model: Object3D) {
    this.alive.delete(model); this.compiled.delete(model);
    this.outgoing?.invalidate(model);
    for (const c of this.active?.candidates ?? []) c.snapshot?.invalidate(model);
  }
  get busy() { return Boolean(this.active && !this.active.warming); }
  report(now: number): PreparedViewReport {
    return {...this.reportValue, preparationMs:this.active && !this.active.ready ? Math.max(0,now-this.active.startedAt) : this.reportValue.preparationMs,
      recentPreparationsMs:[...this.reportValue.recentPreparationsMs],
      manifestModels:this.active?.candidates.reduce((n,c)=>n+(c.snapshot?.meshes.length ?? 0),0) ?? 0,
      remainingModels:this.active?.candidates.reduce((n,c)=>n+(c.snapshot?.meshes.filter(m=>!this.compiled.has(m)).length ?? 0),0) ?? 0,
      retainedDisplayModels:this.display?.meshes.length ?? 0,
      pinnedBytes:this.residency().bytes,
      displayTraversalPaused:this.displayTraversalPaused,
      warmInFlight:this.inFlight,
      criticalModels:this.active?.candidates.reduce((n,c)=>n+(c.critical?.length ?? 0),0) ?? 0,
      criticalRemainingModels:this.active?.candidates.reduce((n,c)=>n+(c.critical?.filter(m=>!this.compiled.has(m)).length ?? 0),0) ?? 0,
      handoffShielded:Boolean(this.active?.releaseAt!==null && this.display?.valid),
      handoffStableSamples:this.releaseSamples,
      handoffPendingWork:(this.tiles as TilesRenderer & {stats?:{downloading:number;parsing:number}}).stats ? ((this.tiles as TilesRenderer & {stats:{downloading:number;parsing:number}}).stats.downloading + (this.tiles as TilesRenderer & {stats:{downloading:number;parsing:number}}).stats.parsing) : 0,
      candidates:this.active?.candidates.map(c=>({targetErrorM:c.solution?.targetErrorM ?? null,clearanceM:c.solution?.clearanceM ?? null,frozen:Boolean(c.snapshot), rangeM:c.pose.rangeM,heightM:c.solution?.heightM,liftM:c.solution?.liftM, ...this.surfaceAvailability(c)})) ?? [],
    };
  }
  request(pose: GoogleRouteCameraPose, options: ReplayViewRequestOptions, from?: GoogleRouteCameraPose, warming=false): Promise<ReplayPreparedView> {
    this.cancel(true);
    this.releaseSamples=0;
    if (this.closed || options.signal.aborted) return Promise.reject(new DOMException("Preparation cancelled","AbortError"));
    const startedAt=performance.now();
    if (!warming) this.captureOutgoing(startedAt);
    const path=preparedCameraPath(warming ? undefined : from,pose,this.route);
    const candidates=path.map((p,index)=>{
      const camera=new PerspectiveCamera(p.fovDeg,this.renderer.domElement.clientWidth/Math.max(1,this.renderer.domElement.clientHeight),.5,20000);
      this.tiles.setCamera(camera);this.tiles.setResolutionFromRenderer(camera,this.renderer);
      const target=new WorldSupportRegion(4),support=new WorldSupportRegion(4);
      // Only the final requested shot gets a visual-footprint region. Intermediate
      // cameras remain validation waypoints rather than extra streaming horizons.
      const focus=!warming && index===path.length-1 ? new WorldSupportRegion(10) : undefined;
      this.regions.addRegion(target);this.regions.addRegion(support);
      return {pose:p,camera,target,support,focus,focusActive:false};
    });
    this.reportValue={...this.reportValue,phase:warming?"warming":"preparing",requestId:options.requestId,selectedProgressM:pose.progressM,
      preparationMs:0,reason:"surface",candidateCameras:candidates.length,coverage:0,rasterCoverage:0,broadRasterCoverage:0,stableSamples:0};
    const promise=new Promise<ReplayPreparedView>(resolve=>{
      const abort=()=>this.cancel();
      this.active={pose:copyPose(pose),options,candidates,startedAt,deadline:startedAt+(warming?5000:PREPARATION_DEADLINE_MS),stableSamples:0,ready:false,warming,resolve,abort,releaseAt:null};
      options.signal.addEventListener("abort",abort,{once:true});
    });
    this.nextCheck=0;this.updateCameras();return promise;
  }
  private surfaceAvailability(c: Candidate) {
    const up=this.frame.normal(c.pose.center.lat,c.pose.center.lng), seed=c.pose.center.altitude ?? 0;
    const target=this.surfaces.cast(this.frame.position(c.pose.center.lat,c.pose.center.lng,Math.max(10000,seed+2000)),up.clone().negate(),65536);
    const ground=this.surfaces.cast(c.camera.position.clone().addScaledVector(up,2000),up.clone().negate(),65536);
    return {targetAvailableErrorM:target?.geometricErrorM ?? null,cameraAvailableErrorM:ground?.geometricErrorM ?? null};
  }
  private captureOutgoing(now: number) {
    if(this.outgoing || this.display)return;
    const view=sampleWorldView(this.tiles,this.displayCamera,now);
    if(!view.centerHit || view.hits<Math.ceil(view.tested*.93))return;
    const resident=this.residency();
    const snapshot=WorldTerrainSnapshot.capture(this.tiles,this.displayCamera,Math.min(160*1024*1024,this.pinnedLimit-resident.bytes),resident.tiles);
    if(snapshot){
      if(this.rasterCoverage(this.displayCamera,snapshot,true).ground>=.94){this.outgoing=snapshot;this.display=snapshot;}
      else snapshot.dispose();
    }
  }
  private restoreDisplayedTraversal() {
    if(!this.displayTraversalPaused)return;
    this.tiles.setCamera(this.displayCamera);
    this.tiles.setResolutionFromRenderer(this.displayCamera,this.renderer);
    this.displayTraversalPaused=false;
  }
  private updateCameras() {
    const active=this.active;if(!active)return;
    for(const c of active.candidates) {
      if(c.snapshot && !c.snapshot.valid) {
        // An evicted/replaced dependency cannot ever become ready again. Rebuild
        // this one finite cohort, without extending the request's original deadline.
        c.snapshot.dispose();c.snapshot=undefined;c.critical=undefined;c.solution=undefined;
        active.stableSamples=0;active.ready=false;this.reportValue.cohortRestarts++;
      }
      if(c.snapshot) continue; // The finite manifest and its solved camera are one unit.
      c.camera.aspect=this.renderer.domElement.clientWidth/Math.max(1,this.renderer.domElement.clientHeight);
      c.solution=solveWorldCamera(this.frame,this.surfaces,c.pose,c.camera,this.route.elevationStatus!=="unavailable");
      // Validate the same projection that WorldFrame gives the displayed camera.
      // An artificial 2.5 km far plane can report missing terrain that is in the real view.
      this.tiles.setResolutionFromRenderer(c.camera,this.renderer);
      if(this.route.elevationStatus!=="unavailable" && c.pose.rangeM<=2500) {
        const targetPosition=this.frame.position(c.pose.center.lat,c.pose.center.lng,(c.pose.center.altitude ?? 0)+c.solution.targetCorrectionM);
        c.target.locate(this.frame,targetPosition,16);
        const up=this.frame.normal(c.pose.center.lat,c.pose.center.lng);
        const support=c.camera.position.clone().addScaledVector(up,(c.pose.center.altitude ?? 0)+c.solution.targetCorrectionM-this.frame.height(c.camera.position));
        c.support.locate(this.frame,support,16);
        if(c.focus && c.focusActive) {
          // Load the visual corridor between the requested route subject and the
          // ground beneath the camera. A target-only disk can leave foreground
          // holes even while spending work behind the subject.
          const focusCenter=targetPosition.clone().lerp(support,0.5);
          const focusRadius=Math.min(360,Math.max(160,targetPosition.distanceTo(support)*0.65));
          c.focus.locate(this.frame,focusCenter,focusRadius,800);
        }
      } else {
        this.regions.removeRegion(c.target);this.regions.removeRegion(c.support);if(c.focus)this.regions.removeRegion(c.focus);
      }
    }
    this.priority.update(active.warming ? [] : active.candidates.map(c=>({
      camera:c.camera,
      criticalRegions:[c.target,c.support].filter(r=>this.regions.hasRegion(r)),
      focusRegions:c.focus && c.focusActive && this.regions.hasRegion(c.focus)?[c.focus]:[],
    })), this.tiles.group.matrixWorld);
  }
  /** Called before tiles.update so selection is aimed at the actual corrected candidates. */
  update(now: number) {
    const active=this.active;if(!active)return;
    this.retain();
    if(this.displayTraversalPaused && !this.display?.valid)this.restoreDisplayedTraversal();
    // Retained geometry keeps the outgoing view drawable; do not keep refining
    // its unrelated horizon while the user's selected destination is pending.
    if(!active.warming && active.releaseAt===null && this.outgoing?.valid && !this.displayTraversalPaused) {
      this.tiles.deleteCamera(this.displayCamera);this.displayTraversalPaused=true;
    }
    if(active.releaseAt!==null) return; // Release only after the actual displayed selection can take over.
    if(now>=this.nextCheck && !active.ready) this.updateCameras();
    // Readiness probes are sparse; prewarming progresses every display frame.
    // Small batches avoid an independent shader-poll round trip per terrain mesh.
    if(!active.ready)for(const c of active.candidates)if(c.snapshot)this.warm(c.snapshot,c.camera,c.critical ?? c.snapshot.meshes);
  }
  /** One bounded visual-critical cohort at a time; GPU program compilation can proceed in parallel. */
  private warm(snapshot: WorldTerrainSnapshot, camera: PerspectiveCamera, requested: readonly Mesh[]) {
    if(!snapshot.valid || this.inFlight)return;
    const batch=requested.filter(model=>!this.compiled.has(model)).slice(0,24);
    if(!batch.length)return;
    try {
      for(const model of batch) {
        const textures=new Set<Texture>();
        for(const material of Array.isArray(model.material)?model.material:[model.material])
          for(const value of Object.values(material))if(value instanceof Texture)textures.add(value);
        for(const texture of textures)this.renderer.initTexture(texture);
      }
      this.inFlight++;
      const releaseMaterials=snapshot.holdMaterials();
      const group=new Group();
      for(const mesh of batch)group.add(new Mesh(mesh.geometry,mesh.material));
      let compilation: Promise<unknown>;
      try { compilation=this.renderer.compileAsync(group,camera,this.scene); }
      catch {group.clear();this.inFlight--;releaseMaterials();this.reportValue.materialFailures++;return;}
      void compilation.then(()=>{
        if(!this.closed && snapshot.valid)for(const mesh of batch){this.compiled.add(mesh);this.reportValue.compiledModels++;}
      }).catch(()=>{this.reportValue.materialFailures++;}).finally(()=>{group.clear();this.inFlight--;releaseMaterials();});
    } catch { this.reportValue.materialFailures++; }
  }
  private residency() {
    return WorldTerrainSnapshot.residency(this.tiles,[this.outgoing,...(this.active?.candidates.map(c=>c.snapshot) ?? [])]);
  }
  /** Pins are refreshed after traversal as well, before the dependency schedules cache eviction. */
  retain() {
    this.outgoing?.retain(this.tiles);
    for(const c of this.active?.candidates ?? []) c.snapshot?.retain(this.tiles);
  }
  /** A retained view is actual resident 3D geometry, not a screenshot or a destination substitute. */
  renderDisplayed(draw: () => void): number {
    const display=this.display;
    if(!display?.valid) { draw(); return 0; }
    let draws=0;
    for(const mesh of display.meshes)mesh.onAfterRender=()=>{draws++;};
    const visible=this.tiles.group.visible;
    this.tiles.group.visible=false; this.scene.add(display.group);
    try { draw(); } finally { display.group.removeFromParent(); this.tiles.group.visible=visible; }
    return draws;
  }
  displayedCoverage(now: number) {
    return this.display?.valid ? sampleWorldMeshes(this.display.meshes,this.displayCamera,now) : null;
  }
  /** Tiny real-material raster probe; only terrain, no HUD/labels/route able to fake coverage.
   * `ground` preserves the route-subject band. `broad` prevents a detailed island
   * in the middle from certifying a close shot whose surrounding landscape is missing. */
  private rasterCoverage(camera: PerspectiveCamera, snapshot?: WorldTerrainSnapshot, silhouette=false) {
    const r=this.renderer, oldTarget=r.getRenderTarget(),viewport=r.getViewport(new Vector4()),scissor=r.getScissor(new Vector4()),scissorTest=r.getScissorTest();
    const color=r.getClearColor(new Color()),alpha=r.getClearAlpha(),tone=r.toneMapping,autoClear=r.autoClear;
    const override=this.scene.overrideMaterial;
    const visibility=[...this.scene.children].map(child=>[child,child.visible] as const);
    try {
      for(const child of this.scene.children)child.visible=!snapshot && child===this.tiles.group;
      if(snapshot)this.scene.add(snapshot.group);
      if(silhouette)this.scene.overrideMaterial=this.silhouetteMaterial;
      r.toneMapping=AgXToneMapping;r.autoClear=true;r.setRenderTarget(this.target);r.setScissorTest(false);r.setClearColor(color,0);
      r.render(this.scene,camera);r.readRenderTargetPixels(this.target,0,0,160,90,this.pixels);
      let groundFilled=0,groundTotal=0,broadFilled=0,broadTotal=0;
      // WebGL rows start at the bottom. The old route-subject band remains a hard
      // requirement, while a wider lower/middle field catches the owner's torn
      // Runner frames without treating intentional high sky as missing terrain.
      for(let y=10;y<76;y++)for(let x=8;x<152;x++){
        broadTotal++;if(this.pixels[(y*160+x)*4+3]>240)broadFilled++;
        if(y>=25&&y<61&&x>=10&&x<150){groundTotal++;if(this.pixels[(y*160+x)*4+3]>240)groundFilled++;}
      }
      return {ground:groundFilled/groundTotal,broad:broadFilled/broadTotal};
    } finally {
      this.scene.overrideMaterial=override;
      snapshot?.group.removeFromParent();
      for(const [child,visible]of visibility)child.visible=visible;
      r.toneMapping=tone;r.autoClear=autoClear;r.setClearColor(color,alpha);r.setRenderTarget(oldTarget);r.setViewport(viewport);r.setScissor(scissor);r.setScissorTest(scissorTest);
    }
  }

  afterTraversal(now: number) {
    this.retain();
    const a=this.active;
    if(now<this.nextCheck)return;
    this.nextCheck=now+200;
    if(!a || a.releaseAt!==null) {
      if(a?.warming) { if(now>=a.releaseAt!)this.release("idle");return; }
      // A successful prepared shot is a handoff shield, not a one-frame certificate.
      // Keep its finite resident geometry until the live replacement is both broad
      // enough and no longer churning under a full decode backlog. This prevents a
      // briefly complete tile set from exposing holes as its refinements replace it.
      if(this.display && (!a || now>=a.releaseAt!)) {
        const view=sampleWorldView(this.tiles,this.displayCamera,now);
        const liveRaster=this.rasterCoverage(this.displayCamera);
        const stats=(this.tiles as TilesRenderer & {stats?:{downloading:number;parsing:number}}).stats;
        const pending=(stats?.downloading ?? 0)+(stats?.parsing ?? 0);
        const usable=view.centerHit && view.hits>=Math.ceil(view.tested*.93) &&
          liveRaster.ground>=.94 && liveRaster.broad>=.82 && pending<=HANDOFF_PENDING_LIMIT;
        this.releaseSamples=usable ? this.releaseSamples+1 : 0;
        if(this.releaseSamples>=HANDOFF_STABLE_SAMPLES) {
          if(a)this.release("arrived");
          else {this.outgoing?.dispose();this.outgoing=undefined;this.display=undefined;}
        }
      } else if(a && now>=a.releaseAt!)this.release("arrived");
      return;
    }
    if(a.ready)return;
    if(!a.warming)this.captureOutgoing(now);
    let reason:ReplayPreparationReason|undefined,coverage=0,raster=0,broadRaster=0;
    for(const [index,c] of a.candidates.entries()) {
      const s=c.solution!;const close=c.pose.rangeM<=800,visualClose=c.pose.rangeM<=1500;
      if(close&&(s.targetErrorM===null||s.targetErrorM>8||s.clearanceM===null||s.clearanceM<17.9)) {reason="surface";break;}
      if(close&&s.sightline!=="clear"){reason="sightline";break;}
      const view=c.snapshot ? sampleWorldMeshes(c.snapshot.meshes,c.camera,now) : sampleWorldView(this.tiles,c.camera,now);
      coverage=index===0 ? (view.tested?view.hits/view.tested:0) : Math.min(coverage,view.tested?view.hits/view.tested:0);
      if(!view.centerHit||coverage<.93){
        if(!a.warming && c.focus && !c.focusActive && c.pose.rangeM<=800 && now-a.startedAt>=4000 && coverage<=.1) {
          c.focusActive=true;this.regions.addRegion(c.focus);this.nextCheck=0;
        }
        reason="coverage";break;
      }
      if(!c.snapshot) {
        const resident=this.residency();
        const snapshot=WorldTerrainSnapshot.capture(this.tiles,c.camera,Math.max(0,this.pinnedLimit-resident.bytes),resident.tiles);
        if(snapshot) {
          // Rays can miss a hole. Do not freeze an incomplete manifest and then
          // wait forever for geometry that can no longer join that manifest.
          const geometry=this.rasterCoverage(c.camera,snapshot,true);
          this.reportValue.geometryCoverage=geometry.ground;
          broadRaster=index===0 ? geometry.broad : Math.min(broadRaster,geometry.broad);
          this.reportValue.broadRasterCoverage=broadRaster;
          if(geometry.ground>=.94 && (!visualClose || geometry.broad>=.82)){
            c.snapshot=snapshot;
            c.critical=collectWorldVisualCriticalMeshes(snapshot.meshes,c.camera,24).meshes;
            if(!c.critical.length){snapshot.dispose();c.snapshot=undefined;reason="coverage";break;}
          } else {snapshot.dispose();reason="coverage";break;}
        }
      }
      if(!c.snapshot?.valid){reason="materials";break;}
      const critical=c.critical ?? [];
      this.warm(c.snapshot,c.camera,critical);
      if(critical.some(model=>!this.compiled.has(model))){reason="materials";break;}
      const materialRaster=this.rasterCoverage(c.camera,c.snapshot);
      raster=index===0 ? materialRaster.ground : Math.min(raster,materialRaster.ground);
      broadRaster=index===0 ? materialRaster.broad : Math.min(broadRaster,materialRaster.broad);
      if(raster<.94 || (visualClose && broadRaster<.82)){reason="coverage";break;}
    }
    a.stableSamples=reason?0:a.stableSamples+1;
    Object.assign(this.reportValue,{coverage,rasterCoverage:raster,broadRasterCoverage:broadRaster,reason:reason??null,stableSamples:a.stableSamples});
    if(a.stableSamples>=3) {
      a.ready=true;this.reportValue.phase=a.warming?"warming":"ready";this.reportValue.preparationMs=now-a.startedAt;
      a.resolve({ready:true,requestId:a.options.requestId,transition:a.candidates.length>1?"flight":"cut",preparationMs:now-a.startedAt});
      if(a.warming)a.releaseAt=now+1000;
      return;
    }
    // Deadline enforcement comes after the current traversal has had its final
    // chance to prove the shot. If complete resident geometry exists, allow only
    // a short proof-settling grace for async shader completion and the three
    // consecutive validation samples; an incomplete destination still fails at
    // the original deadline.
    const broadRequired=a.candidates.some(c=>c.pose.rangeM<=1500);
    const proofQualified=a.candidates.length>0 && a.candidates.every(c=>Boolean(c.snapshot?.valid)) &&
      coverage>=.93 && this.reportValue.geometryCoverage>=.94 && (!broadRequired || broadRaster>=.82);
    if(now>=a.deadline && (!proofQualified || now>=a.deadline+PREPARATION_PROOF_GRACE_MS)) {
      this.reportValue.blocked+=a.warming?0:1;this.reportValue.preparationMs=now-a.startedAt;
      a.resolve({ready:false,requestId:a.options.requestId,reason:"timeout",transition:"cut",preparationMs:now-a.startedAt});
      this.release(a.warming?"idle":"blocked",!a.warming);
    }
  }
  commit(requestId: number) {
    const a=this.active;if(!a||!a.ready||a.options.requestId!==requestId||a.options.signal.aborted)return false;
    a.options.signal.removeEventListener("abort",a.abort);
    this.restoreDisplayedTraversal();this.priority.clear();
    this.outgoing?.dispose();this.outgoing=undefined;this.display=a.candidates.at(-1)?.snapshot;
    a.releaseAt=performance.now()+HANDOFF_MIN_RESIDENCY_MS;this.reportValue.phase="transitioning";this.reportValue.completed++;
    this.reportValue.recentPreparationsMs.push(this.reportValue.preparationMs);
    if(this.reportValue.recentPreparationsMs.length>12)this.reportValue.recentPreparationsMs.shift();
    return true;
  }
  private release(phase: PreparedViewReport["phase"], keepOutgoing=false) {
    const a=this.active;if(!a)return;
    this.restoreDisplayedTraversal();this.priority.clear();
    a.options.signal.removeEventListener("abort",a.abort);
    if(keepOutgoing && this.display && this.display!==this.outgoing) {
      this.outgoing?.dispose(); this.outgoing=this.display;
    }
    for(const c of a.candidates){
      this.tiles.deleteCamera(c.camera);this.regions.removeRegion(c.target);this.regions.removeRegion(c.support);if(c.focus)this.regions.removeRegion(c.focus);
      if(c.snapshot!==this.outgoing)c.snapshot?.dispose();
    }
    if(!keepOutgoing){this.outgoing?.dispose();this.outgoing=undefined;}
    this.display=this.outgoing;
    this.active=undefined;this.reportValue.phase=phase;this.reportValue.candidateCameras=0;
  }
  cancel(keepOutgoing=true) {
    const a=this.active;if(!a)return;
    if(!a.ready){a.resolve({ready:false,requestId:a.options.requestId,reason:"unavailable",transition:"cut",preparationMs:performance.now()-a.startedAt});if(!a.warming)this.reportValue.cancelled++;}
    this.release("idle",keepOutgoing);
  }
  dispose(){this.closed=true;this.cancel();this.outgoing?.dispose();this.outgoing=undefined;this.display=undefined;this.tiles.unregisterPlugin(this.regions);this.priority.dispose();this.target.dispose();this.silhouetteMaterial.dispose();this.alive.clear();}
}
