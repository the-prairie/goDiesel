import { TilesRenderer } from "3d-tiles-renderer/three";
import { GoogleCloudAuthPlugin } from "3d-tiles-renderer/core/plugins";
import { GLTFExtensionsPlugin, TilesFadePlugin } from "3d-tiles-renderer/three/plugins";
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from "three-mesh-bvh";
import { AgXToneMapping, Color, Matrix4, Vector2, Mesh, PerspectiveCamera, Raycaster, Scene, SRGBColorSpace, WebGLRenderer, NoToneMapping } from "three";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { GoogleRouteNavigatorEngine, GoogleRouteNavigatorStatus } from "@/surfaces/replay/renderers/google-route-navigator-engine";
import type { GoogleRouteCameraPose, GoogleRouteGroundingMode } from "@/surfaces/replay/playback/route-navigator-controller";
import type { CinematicRouteTreatment } from "@/surfaces/replay/cinematic/cinematic-route-filament";
import { routeDistanceM } from "@/domain/geometry/route-path";
import { WorldFrame } from "./world-frame";
import { bindWorldDiagnostics, WorldFlightRecorder, WORLD_BUILD, type WorldDiagnostics, type WorldPlaybackContext, type WorldReportState, type WorldReportEvent } from "./world-diagnostics";
import { emptyTerrainFocus, sampleTerrainFocus } from "./world-terrain-diagnostics";
import { configureWorldStreaming, canStartWorldAtmosphere, nextSlowFrameDebt, worldFarPlane } from "./world-streaming";
import { WorldRoute } from "./world-route";
import { WorldAtmosphere } from "./world-atmosphere";
import { createWorldLabels } from "./world-labels";
import { advanceTerrainReadiness, INITIAL_TERRAIN_READINESS } from "./world-readiness";
import { DEFAULT_WORLD_ENVIRONMENT, normalizeEnvironment, WORLD_QUALITY, worldStatus, type WorldEnvironment, type WorldLayers } from "./world-model";

type MountOptions = Parameters<GoogleRouteNavigatorEngine["mount"]>[0];
type Labels = Awaited<ReturnType<typeof createWorldLabels>>;
export interface CinematicWorldEnginePort extends GoogleRouteNavigatorEngine { setEnvironment(environment: WorldEnvironment): void; }
declare global { interface Window { __GODIESEL_CINEMATIC_WORLD_FACTORY__?: () => CinematicWorldEnginePort; } }

export class CinematicWorldEngine implements CinematicWorldEnginePort {
  private abort = new AbortController();
  private renderer?: WebGLRenderer;
  private tiles?: TilesRenderer;
  private frame?: WorldFrame;
  private scene = new Scene();
  private camera = new PerspectiveCamera(54, 1, 0.5, 100_000);
  private controls?: OrbitControls;
  private trace?: WorldRoute;
  private atmosphere?: WorldAtmosphere;
  private labels?: Labels;
  private atmosphereReady = false;
  private atmosphereStarted = false;
  private draco?: DRACOLoader;
  private focusErrorM: number | null = null;
  private shaderFailed = false;
  private labelsStarted = false;
  private labelState: WorldLayers["labels"] = "loading";
  private options?: MountOptions;
  private resizeObserver?: ResizeObserver;
  private animation = 0;
  private readyTimer = 0;
  private layers: WorldLayers = { terrain: "loading", atmosphere: "loading", labels: "loading", route: "loading" };
  private environment = DEFAULT_WORLD_ENVIRONMENT;
  private lastStatus = "";
  private following = true;
  private pose?: GoogleRouteCameraPose;
  private renderedTiles = 0;
  private terrainReadiness = INITIAL_TERRAIN_READINESS;
  private terrainGaps = false;
  private attribution?: HTMLDivElement;
  private lastAttribution = "";
  private effectiveQuality = this.environment.quality;
  private slowFrames = 0;
  private raycaster = new Raycaster();
  private measuredTarget: number | null = null;
  private lastTargetSample = -Infinity;
  private lastCameraCorrection = 0;
  private readonly recorder = new WorldFlightRecorder(performance.now(), !document.hidden);
  private playback: WorldPlaybackContext | null = null;
  private focusProbe = emptyTerrainFocus();
  private readonly probeView = new Matrix4();
  private readonly probeProjection = new Matrix4();
  private lastDiagnosticSample = -Infinity;
  private unbindDiagnostics?: () => void;

  async mount(options: MountOptions) {
    this.options = options;
    this.publish();
    const { container, route } = options;
    this.unbindDiagnostics = bindWorldDiagnostics(container, () => this.diagnostics());
    document.addEventListener("visibilitychange", this.onVisibility);
    if (!route.replay.replayEligible || route.lifecycle === "planned" || route.replay.geometryStatus !== "ready" || route.route.length < 2) {
      this.fail("This route has no replayable recorded geometry."); return;
    }
    const key = import.meta.env.VITE_WORLD_GOOGLE_MAPS_API_KEY || options.apiKey;
    if (!key) { this.fail("Cinematic world needs a browser key with Google Map Tiles API enabled. Native Replay and Atlas remain available."); return; }
    try {
      const renderer = new WebGLRenderer({ antialias: false, alpha: false, powerPreference: "high-performance" });
      this.renderer = renderer;
      renderer.debug.onShaderError = () => { this.shaderFailed = true; };
      renderer.outputColorSpace = SRGBColorSpace;
      renderer.toneMapping = AgXToneMapping;
      renderer.setClearColor(new Color("#aabdc7"));
      renderer.domElement.dataset.testid = "cinematic-world-canvas";
      renderer.domElement.tabIndex = 0;
      renderer.domElement.setAttribute("aria-label", `Cinematic 3D terrain for ${route.name}. Drag to explore; use Replay controls to follow the route.`);
      renderer.domElement.style.cssText = "width:100%;height:100%;display:block;outline-offset:-4px";
      renderer.domElement.addEventListener("webglcontextlost", this.onContextLost);
      container.replaceChildren(renderer.domElement);
      const frame = new WorldFrame(route.centerLat, route.centerLng);
      this.frame = frame;
      this.trace = new WorldRoute(route, frame);
      this.scene.add(this.trace.group);
      this.layers.route = this.trace.grounded ? "ready" : "loading";
      const tiles = new TilesRenderer("https://tile.googleapis.com/v1/3dtiles/root.json");
      this.tiles = tiles;
      configureWorldStreaming(tiles);
      tiles.fetchOptions = { signal: this.abort.signal };
      tiles.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: key }));
      const draco = new DRACOLoader().setWorkerLimit(2).setDecoderPath(`${import.meta.env.BASE_URL}world-assets/draco/`);
      this.draco = draco;
      // Own disposal explicitly; the pinned plugin does not assign autoDispose.
      tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: draco, autoDispose: false }));
      tiles.registerPlugin(new TilesFadePlugin({ fadeDuration: this.environment.reducedMotion ? 0 : 200 }));
      tiles.group.matrix.copy(frame.ecefToWorld);
      tiles.group.matrixAutoUpdate = false;
      this.scene.add(tiles.group);
      tiles.setCamera(this.camera);
      tiles.addEventListener("load-model", ({ scene }) => {
        scene.traverse((object) => {
          if (!(object instanceof Mesh)) return;
          // Bound synchronous BVH work to modest tile meshes; no global prototype mutation.
          if (object.geometry.attributes.position?.count < 12_000 && !object.geometry.boundsTree) {
            computeBoundsTree.call(object.geometry);
            object.raycast = acceleratedRaycast;
          }
          const previous = object.onAfterRender;
          object.onAfterRender = (...args) => { previous.apply(object, args); this.renderedTiles += 1; };
        });
        this.trace?.invalidate();
      });
      tiles.addEventListener("dispose-model", ({ scene }) => scene.traverse((object) => {
        if (object instanceof Mesh && object.geometry.boundsTree) disposeBoundsTree.call(object.geometry);
      }));
      tiles.addEventListener("tile-visibility-change", () => this.trace?.invalidate());
      tiles.addEventListener("load-error", ({ tile }) => {
        if (this.abort.signal.aborted) return;
        if (!tile) this.fail("Google 3D terrain could not load. Check Map Tiles API access, billing and this browser origin.");
        else { this.terrainGaps = true; this.publish(); }
      });
      this.raycaster.firstHitOnly = true;
      const initial = options.initialCamera;
      if (initial) this.setCamera(initial);
      const controls = new OrbitControls(this.camera, renderer.domElement);
      this.controls = controls;
      controls.enableDamping = false;
      controls.minDistance = 20;
      controls.maxDistance = 150_000;
      controls.maxPolarAngle = Math.PI * 0.46;
      if (initial) controls.target.copy(frame.position(initial.center.lat, initial.center.lng, initial.center.altitude ?? route.route[0].elev));
      if (initial) this.setCamera(initial);
      controls.addEventListener("start", () => { if (this.following) options.onCameraInteraction?.(); });
      controls.addEventListener("change", () => {
        if (!this.following) {
          const range = this.camera.position.distanceTo(controls.target);
          this.camera.near = Math.max(0.5, range / 100);
          this.camera.far = worldFarPlane(range);
          this.camera.updateProjectionMatrix();
        }
      });
      controls.listenToKeyEvents(renderer.domElement);
      renderer.domElement.addEventListener("keydown", this.onKey);
      this.attribution = document.createElement("div");
      this.attribution.dataset.testid = "cinematic-world-attribution";
      this.attribution.style.cssText = "position:absolute;left:12px;bottom:calc(var(--world-dock-height,180px) + 8px);max-width:calc(100% - 24px);z-index:50;background:rgba(255,255,255,.94);color:#202124;padding:6px 10px;font:11px/1.4 Arial,sans-serif;border-radius:3px;pointer-events:auto";
      container.append(this.attribution);
      this.updateAttribution();
      this.resizeObserver = new ResizeObserver(this.resize);
      this.resizeObserver.observe(container);
      this.applyEnvironment();
      this.resize();
      this.readyTimer = window.setTimeout(() => {
        if (this.layers.terrain !== "ready") this.fail("Photorealistic terrain did not render in time. Use Native Replay or Atlas; no substitute scenery has been loaded.");
      }, 35_000);
      this.atmosphere = new WorldAtmosphere(renderer, this.scene, this.camera, frame.worldToECEF, this.environment,
        route.route.reduce((height, point) => Math.max(height, Number.isFinite(point.elev) ? point.elev : 0), 0));
      void this.atmosphere.load(this.abort.signal).then(() => {
        if (this.abort.signal.aborted) return;
        this.atmosphereReady = true;
        renderer.toneMapping = AgXToneMapping;
        this.resize(); this.publish();
      }).catch(() => {
        if (this.abort.signal.aborted) return;
        this.layers.atmosphere = "unavailable";
        renderer.toneMapping = AgXToneMapping; renderer.toneMappingExposure = 1;
        this.publish();
      });
      this.startLabels();
      let previous = performance.now();
      const tick = (now: number) => {
        if (this.abort.signal.aborted) return;
        this.animation = requestAnimationFrame(tick);
        const elapsed = now - previous;
        previous = now;
        if (document.hidden) { this.slowFrames = 0; return; }
        this.recorder.frame(now, this.playback);
        let phase = "tiles";
        try {
          this.camera.updateMatrixWorld();
          this.scene.updateMatrixWorld(true);
          tiles.update();
          this.scene.updateMatrixWorld(true);
          phase = "route-grounding";
          this.trace?.settle(this.sampleHeight, now);
          if (this.trace?.grounded) this.layers.route = "ready";
          phase = "camera-grounding";
          if (this.pose && this.following && now - this.lastTargetSample > 500) {
            this.lastTargetSample = now;
            this.measuredTarget = this.sampleHeight(this.pose.center.lat, this.pose.center.lng, this.pose.center.altitude ?? 0, true);
            this.setCamera(this.pose);
          }
          this.renderedTiles = 0;
          // Draw terrain first. Expensive optional cloud shaders must not delay the first landscape.
          if (!this.atmosphereStarted && this.layers.terrain === "ready" &&
            canStartWorldAtmosphere(this.focusErrorM, this.pose?.rangeM ?? 1000, tiles.loadProgress)) {
            this.atmosphereStarted = true;
          }
          phase = this.atmosphereReady && this.atmosphereStarted ? "atmosphere" : "terrain-render";
          if (phase === "atmosphere") {
            renderer.toneMapping = NoToneMapping;
            this.atmosphere?.render(Math.min(0.1, elapsed / 1000));
            this.layers.atmosphere = "ready";
          } else renderer.render(this.scene, this.camera);
          if (this.shaderFailed) { this.shaderFailed = false; throw new Error("World shader could not compile"); }
          // Background refinement is not a failure to draw. A visible, still-refining
          // landscape is playable with a partial status; an empty canvas is not.
          this.terrainReadiness = advanceTerrainReadiness(this.terrainReadiness, this.renderedTiles, tiles.loadProgress);
          if (this.terrainReadiness.ready) { this.layers.terrain = "ready"; window.clearTimeout(this.readyTimer); }
          container.dataset.terrainRefining = String(this.terrainReadiness.refining);
          if (this.layers.terrain === "ready" && this.environment.quality === "balanced") {
            this.slowFrames = nextSlowFrameDebt(this.slowFrames, elapsed, true);
            if (this.slowFrames >= 4000 && this.effectiveQuality !== "light") { this.effectiveQuality = "light"; this.applyEnvironment(); }
          }
          container.dataset.renderedTileMeshes = String(this.renderedTiles);
          container.dataset.visibleTiles = String(tiles.visibleTiles.size);
          container.dataset.terrainFocusErrorM = this.focusErrorM === null ? "unavailable" : this.focusErrorM.toFixed(2);
          container.dataset.worldLabelCount = String(this.labels?.visibleLabelCount ?? 0);
          container.dataset.cameraMeshCorrectionM = this.lastCameraCorrection.toFixed(1);
          this.recorder.submitted(performance.now(), this.renderedTiles);
          // Diagnostics observe at most once a second; never change detail selection.
          if (now - this.lastDiagnosticSample >= 1000) {
            this.lastDiagnosticSample = now;
            try {
              this.focusProbe = sampleTerrainFocus(tiles, this.camera, this.recorder.time(now), renderer.getSize(new Vector2()).y);
              this.probeView.copy(this.camera.matrixWorld);
              this.probeProjection.copy(this.camera.projectionMatrix);
            } catch { this.focusProbe = { ...emptyTerrainFocus(), sampledAtMs: this.recorder.time(now), reason: "sample-error" }; }
            this.recorder.sample(now, this.reportState(now));
          }
          this.updateAttribution(); this.publish();
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unexpected renderer error";
          // Diagnostic only: never expose provider URLs, API keys or session tokens.
          container.dataset.worldFailurePhase = phase;
          container.dataset.worldFailure = message.replace(/https?:\/\/\S+/g, "[provider URL]").replace(/AIza[\w-]+/g, "[redacted]").slice(0, 300);
          if (phase === "tiles" && this.labels) {
            this.labels.dispose(); this.labels = undefined;
            this.labelState = this.layers.labels = "unavailable";
            this.publish();
          } else if (phase === "atmosphere") {
            this.atmosphereReady = false; this.atmosphere?.dispose();
            this.layers.atmosphere = "unavailable";
            renderer.toneMapping = AgXToneMapping; renderer.toneMappingExposure = 1;
            this.publish();
          } else this.fail("The cinematic renderer could not draw this scene. Native Replay and Atlas remain available.");
        }
      };
      this.animation = requestAnimationFrame(tick);
    } catch { this.fail("This browser could not start the cinematic 3D world. Try a WebGL2-capable browser, Native Replay or Atlas."); }
  }

  private reportState(now = performance.now()): WorldReportState {
    const cache = this.tiles?.lruCache as unknown as { cachedBytes?: number } | undefined;
    const stats = (this.tiles as unknown as { stats?: { downloading: number; parsing: number; failed: number } } | undefined)?.stats;
    return {
      playback: this.playback ? { ...this.playback } : null,
      camera: {
        requestedMode: this.playback?.cameraMode ?? null,
        directedMode: this.following ? this.pose?.directedMode ?? this.playback?.cameraMode ?? null : null,
        owner: this.following ? "following" : "free",
        requestedRangeM: this.pose?.rangeM ?? null,
        actualRangeM: this.controls ? this.camera.position.distanceTo(this.controls.target) : null,
        fovDeg: this.camera.fov, nearM: this.camera.near, farM: this.camera.far, meshCorrectionM: this.lastCameraCorrection,
      },
      layers: { ...this.layers },
      quality: {
        requested: this.environment.quality, effective: this.effectiveQuality,
        light: this.environment.light, clouds: this.environment.clouds, labels: this.environment.labels,
        cloudsEnabled: this.layers.atmosphere === "ready" && this.atmosphereStarted && this.atmosphereReady && WORLD_QUALITY[this.effectiveQuality].clouds && this.environment.clouds > 0,
      },
      terrain: {
        renderedMeshes: this.renderedTiles, visibleTiles: this.tiles?.visibleTiles.size ?? 0,
        focusErrorM: this.focusProbe.geometricErrorM,
        progress: this.tiles?.loadProgress ?? 0, cachedBytes: cache?.cachedBytes ?? 0,
        errorTargetPx: this.tiles?.errorTarget ?? WORLD_QUALITY[this.effectiveQuality].errorTarget,
        focus: {
          ...this.focusProbe,
          ageMs: this.focusProbe.sampledAtMs === null ? null : Math.max(0, this.recorder.time(now) - this.focusProbe.sampledAtMs),
          cameraChangedSinceSample: !this.probeView.equals(this.camera.matrixWorld) || !this.probeProjection.equals(this.camera.projectionMatrix),
        },
        queues: { downloading: stats?.downloading ?? 0, parsing: stats?.parsing ?? 0, failed: stats?.failed ?? 0 },
      },
      visibleRoadLabels: this.labels?.visibleLabelCount ?? 0,
      contextLost: this.renderer?.getContext().isContextLost() ?? false,
    };
  }
  private markReport(kind: WorldReportEvent) { this.recorder.mark(kind, performance.now(), this.reportState()); }
  setPlaybackContext(context: WorldPlaybackContext, intent?: "seek") {
    const previous = this.playback;
    // Explicit whitelist: never serialize a controller, route or arbitrary caller fields.
    this.playback = {
      playing: context.playing, progressM: context.progressM, speed: context.speed,
      cameraMode: context.cameraMode, groundingMode: context.groundingMode,
      following: context.following, rangeScale: context.rangeScale,
      cameraSettling: context.cameraSettling, settingsOpen: context.settingsOpen, reducedMotion: context.reducedMotion,
    };
    if (previous) {
      if (previous.playing !== context.playing) this.markReport(context.playing ? "play" : "pause");
      if (previous.cameraMode !== context.cameraMode) this.markReport("camera-mode");
      if (previous.following !== context.following) this.markReport(context.following ? "recenter" : "free-camera");
      if (previous.rangeScale !== context.rangeScale) this.markReport("zoom");
      if (previous.speed !== context.speed) this.markReport("speed");
      if (previous.groundingMode !== context.groundingMode) this.markReport("grounding");
      if (previous.settingsOpen !== context.settingsOpen) this.markReport(context.settingsOpen ? "settings-open" : "settings-close");
    }
    if (intent === "seek") this.markReport("seek");
  }
  private diagnostics(): WorldDiagnostics {
    const now = performance.now();
    const gl = this.renderer?.getContext();
    const debug = gl?.getExtension("WEBGL_debug_renderer_info");
    const graphics = gl ? String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) : "unavailable";
    return {
      schema: "godiesel-world-report-v2", build: { ...WORLD_BUILD },
      routeSlug: this.options?.route.slug ?? "unknown", capturedAt: new Date().toISOString(),
      device: { browser: navigator.userAgent, graphics, softwareRenderer: /swiftshader|llvmpipe|software/i.test(graphics), width: window.innerWidth, height: window.innerHeight, pixelRatio: window.devicePixelRatio },
      ...this.reportState(now), ...this.recorder.snapshot(now),
      interpretation: {
        frames: "Callback intervals, not GPU-presented FPS. Hidden intervals are excluded; transitions are separate.",
        terrain: "Center-ray geometric error estimates detail, not route/label positional accuracy. Loading progress is not a quality score.",
      },
    };
  }

  private onVisibility = () => { this.recorder.visibility(performance.now(), !document.hidden); this.slowFrames = 0; };
  private onContextLost = (event: Event) => { event.preventDefault(); this.markReport("context-lost"); this.fail("The browser lost its 3D graphics context. Reopen Cinematic world or use Native Replay."); };
  private onKey = (event: KeyboardEvent) => {
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) && this.following) this.options?.onCameraInteraction?.();
  };
  private resize = () => {
    if (!this.renderer || !this.options) return;
    const { width, height } = this.options.container.getBoundingClientRect();
    if (width < 1 || height < 1) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height; this.camera.updateProjectionMatrix();
    this.tiles?.setResolutionFromRenderer(this.camera, this.renderer);
    this.trace?.resize(width, height); this.atmosphere?.resize(width, height);
  };
  private sampleHeight = (lat: number, lng: number, seed: number, focus = false): number | null => {
    if (!this.frame || !this.tiles?.visibleTiles.size) return null;
    this.raycaster.set(this.frame.position(lat, lng, Math.max(10_000, seed + 2000)), this.frame.normal(lat, lng).negate());
    const hit = this.raycaster.intersectObject(this.tiles.group, true)[0];
    if (focus) {
      const error: unknown = hit?.object.userData.tile?.geometricError;
      this.focusErrorM = typeof error === "number" && Number.isFinite(error) ? error : null;
    }
    return hit ? this.frame.height(hit.point) : null;
  };
  setCamera(pose: GoogleRouteCameraPose) {
    if (this.pose && Math.abs(this.pose.progressM - pose.progressM) > 500) this.measuredTarget = null;
    this.pose = pose;
    if (!this.frame || !this.following || !this.options) return;
    const recorded = this.options.route.elevationStatus !== "unavailable";
    const height = recorded ? pose.center.altitude ?? this.options.route.route[0].elev : this.measuredTarget ?? pose.center.altitude ?? 0;
    const correction = recorded && this.measuredTarget !== null ? Math.max(-120, Math.min(120, this.measuredTarget - height)) : 0;
    const target = this.frame.camera(this.camera, pose, height + correction);
    this.controls?.target.copy(target);
    // Mesh clearance at the actual camera footprint is a rendering correction, not a recorded value.
    const position = this.camera.position.clone();
    const up = this.frame.normal(pose.center.lat, pose.center.lng);
    this.raycaster.set(position.clone().addScaledVector(up, 1500), up.clone().negate());
    const hit = this.tiles?.visibleTiles.size ? this.raycaster.intersectObject(this.tiles.group, true)[0] : undefined;
    const clearance = hit ? position.sub(hit.point).dot(up) : Infinity;
    this.lastCameraCorrection = Math.max(0, 18 - clearance);
    if (Number.isFinite(this.lastCameraCorrection) && this.lastCameraCorrection > 0) {
      this.camera.position.addScaledVector(up, this.lastCameraCorrection);
      this.camera.lookAt(target); this.camera.updateMatrixWorld();
    }
  }
  setFollowing(following: boolean) { this.following = following; }
  setGrounding(mode: GoogleRouteGroundingMode) { this.trace?.grounding(mode === "mesh"); }
  setCinematicRoute(treatment: CinematicRouteTreatment) {
    this.trace?.update(treatment.focusRatio * (this.options ? routeDistanceM(this.options.route) : 1), treatment.rangeM);
  }
  setRouteReveal(progress: number) { this.trace?.setReveal(Math.max(0, Math.min(1, progress)) * (this.options ? routeDistanceM(this.options.route) : 1)); }
  setEnvironment(environment: WorldEnvironment) {
    const next = normalizeEnvironment(environment);
    if (next.quality !== this.environment.quality) { this.effectiveQuality = next.quality; this.slowFrames = 0; }
    const changed = JSON.stringify(next) !== JSON.stringify(this.environment);
    this.environment = next; this.applyEnvironment(); this.startLabels(); this.publish();
    if (changed) this.markReport("environment");
  }
  private applyEnvironment() {
    const settings = { ...this.environment, quality: this.effectiveQuality };
    const quality = WORLD_QUALITY[this.effectiveQuality];
    this.renderer?.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatio));
    if (this.tiles) this.tiles.errorTarget = quality.errorTarget;
    this.atmosphere?.update(settings); this.labels?.update(settings);
    this.layers.labels = this.environment.labels ? this.labelState : "off";
    if (this.options) {
      if (this.options.container.dataset.effectiveQuality !== this.effectiveQuality) this.markReport("quality");
      this.options.container.dataset.effectiveQuality = this.effectiveQuality;
    }
    this.resize();
  }
  private startLabels() {
    if (this.labelsStarted || !this.tiles || !this.environment.labels || this.abort.signal.aborted) return;
    this.labelsStarted = true;
    void createWorldLabels(this.tiles, this.camera, this.abort.signal, this.environment, (state) => {
      this.labelState = state; this.layers.labels = this.environment.labels ? state : "off"; this.publish();
    }).then((labels) => {
      if (this.abort.signal.aborted) { labels.dispose(); return; }
      this.labels = labels; labels.update({ ...this.environment, quality: this.effectiveQuality });
    }).catch(() => {
      if (!this.abort.signal.aborted) { this.labelState = "unavailable"; this.layers.labels = this.environment.labels ? "unavailable" : "off"; this.publish(); }
    });
  }
  private updateAttribution() {
    if (!this.attribution) return;
    const names = this.tiles?.getAttributions().filter(({ type, value }) => type === "string" && typeof value === "string").map(({ value }) => String(value)).join(" · ") ?? "";
    const terrainText = `Terrain · Google Maps${names ? ` · ${names}` : ""}`;
    const text = `${terrainText}|${this.labels?.attribution ?? ""}`;
    if (text === this.lastAttribution) return;
    this.lastAttribution = text;
    // Attribution is text, never provider-controlled innerHTML. It stays visible when the HUD fades.
    this.attribution.replaceChildren();
    const terrain = document.createElement("span"); terrain.translate = false; terrain.textContent = terrainText;
    const roads = document.createElement(this.labels?.defaultSource ? "a" : "span");
    if (roads instanceof HTMLAnchorElement) { roads.href = "https://www.openstreetmap.org/copyright"; roads.target = "_blank"; roads.rel = "noopener noreferrer"; }
    roads.textContent = `Road names · ${this.labels?.attribution ?? "Loading map credits"}`;
    roads.style.textDecoration = "underline";
    this.attribution.append(terrain);
    if (this.labels) this.attribution.append(document.createTextNode(" | "), roads);
    this.attribution.append(document.createTextNode(" | Light & clouds · simulated"));
  }
  private publish() {
    if (!this.options || this.abort.signal.aborted) return;
    let state = worldStatus(this.layers);
    if (state === "ready" && (this.terrainGaps || this.terrainReadiness.refining || this.effectiveQuality !== this.environment.quality)) state = "partial";
    const missing = Object.entries(this.layers).filter(([, value]) => value === "unavailable").map(([key]) => key);
    const message = state === "loading" ? "Entering real photorealistic terrain." : [
      "Cinematic world", missing.length ? `${missing.join(" and ")} unavailable` : "",
      Object.values(this.layers).includes("loading") ? "Additional layers are still loading" : "",
      this.terrainGaps ? "Some terrain tiles are unavailable" : "",
      this.terrainReadiness.refining ? "Terrain detail is still loading" : "",
      this.effectiveQuality !== this.environment.quality ? "Light quality selected to keep the flight responsive" : "",
    ].filter(Boolean).join(" · ");
    const signature = JSON.stringify([state, message, this.layers]);
    if (signature === this.lastStatus) return;
    this.lastStatus = signature;
    this.markReport("layers");
    Object.assign(this.options.container.dataset, { worldTerrain: this.layers.terrain, worldAtmosphere: this.layers.atmosphere, worldLabels: this.layers.labels, worldRoute: this.layers.route });
    this.options.onStatus({ state, message } as GoogleRouteNavigatorStatus);
  }
  private fail(message: string) {
    this.layers.terrain = "unavailable";
    this.markReport("failure"); this.recorder.stop(performance.now());
    if (this.options) this.options.container.dataset.worldTerrain = "unavailable";
    this.options?.onStatus({ state: "unavailable", message });
    this.abort.abort(); cancelAnimationFrame(this.animation); window.clearTimeout(this.readyTimer);
  }
  destroy() {
    this.recorder.stop(performance.now());
    this.unbindDiagnostics?.();
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.abort.abort(); cancelAnimationFrame(this.animation); window.clearTimeout(this.readyTimer);
    this.resizeObserver?.disconnect(); this.controls?.stopListenToKeyEvents(); this.controls?.dispose();
    this.labels?.dispose(); this.atmosphere?.dispose(); this.tiles?.dispose(); this.draco?.dispose(); this.trace?.dispose();
    this.renderer?.domElement.removeEventListener("webglcontextlost", this.onContextLost);
    this.renderer?.domElement.removeEventListener("keydown", this.onKey);
    this.renderer?.dispose(); this.renderer?.forceContextLoss(); this.renderer?.domElement.remove();
    this.attribution?.remove(); this.scene.clear();
  }
}
export function createCinematicWorldEngine(): CinematicWorldEnginePort {
  return window.__GODIESEL_CINEMATIC_WORLD_FACTORY__?.() ?? new CinematicWorldEngine();
}
