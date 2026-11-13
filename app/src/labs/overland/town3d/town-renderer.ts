// The town renderer: one three.js scene for one town plan, its camera, its
// light, and the moves the jump asks of it. This module is a lazy chunk; it
// loads only when a town opens, and `dispose` frees everything it made.

import {
  Color,
  ColorManagement,
  DirectionalLight,
  Fog,
  HemisphereLight,
  PCFShadowMap,
  PerspectiveCamera,
  PointLight,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";

import type { QuestRoute } from "@/domain/route";
import { RUNNER_ROWS, type RunnerFacing } from "@/labs/overland/engine/runner";
import { PLACE_DEFAULT_LIGHT, type TownLight } from "@/labs/overland/model/run-light";
import { TOWN_FOV_DEG, cameraPosition, diveTarget, homePose, mixPose, runnerFacing, trailOnGround, type TownPose } from "@/labs/overland/model/town-camera";
import type { TownPlan } from "@/labs/overland/model/town-plan";
import { FRAME_WINDOW, judgeFrames, qualitySettings, treesKept, type QualityTier } from "@/labs/overland/model/town-quality";
import { paintTrail } from "@/labs/overland/town3d/painters";
import { TRAIL_SIZE, TRAIL_TEXELS, buildTownScene, type TownScene } from "@/labs/overland/town3d/town-scene";
import { googleRouteCameraPose, initialGoogleRouteNavigatorState } from "@/surfaces/replay/playback/route-navigator-controller";
import { sustainedRouteCamera } from "@/surfaces/replay/scene/route-camera-score";

/**
 * The 3D world's opening camera for a route: the pose the Google Replay
 * driver mounts with, read from the same functions it uses.
 */
export function openingCamera(route: QuestRoute, viewportWidth: number) {
  const state = initialGoogleRouteNavigatorState();
  const pose = sustainedRouteCamera(route, state, googleRouteCameraPose(route, state), viewportWidth);
  return { tiltDeg: pose.tiltDeg, fovDeg: pose.fovDeg ?? 35, rangeM: pose.rangeM, headingDeg: pose.headingDeg };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

export interface SignProjection {
  slug: string;
  /** The board's centre and the box to tap, in CSS pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
}

export interface TownRendererOptions {
  /** The element the renderer draws into; it adds its own canvas, and removes it on dispose. */
  host: HTMLElement;
  /** Attributes for the canvas: its name, role and tab order. */
  canvasAttributes?: Record<string, string>;
  plan: TownPlan;
  tier: QualityTier;
  reducedMotion: boolean;
  /** Called after each drawn frame, with where each signpost is on screen. */
  onFrame?: (signs: SignProjection[]) => void;
  onQualityLowered?: (tier: QualityTier) => void;
  onContextLost?: () => void;
}

export interface TownStats {
  fps: number;
  calls: number;
  triangles: number;
  tier: QualityTier;
  trees: number;
  treesDrawn: number;
}

export interface TownRenderer {
  readonly canvas: HTMLCanvasElement;
  resize(width: number, height: number): void;
  setReducedMotion(reduced: boolean): void;
  setLight(light: TownLight, instant?: boolean): void;
  highlight(slug: string | null): void;
  /** The camera dives to stand behind the runner at a signpost. */
  dive(slug: string, opening: { tiltDeg: number; fovDeg: number } | undefined): Promise<void>;
  /** Ends a running dive or surface where it was going. */
  finish(): void;
  /** The hold: she runs out of town, and her line draws on the ground ahead. */
  travel(points: ReadonlyArray<{ lat: number; lng: number }> | null): void;
  /** The way back: the camera returns to the town's home view. */
  surface(): Promise<void>;
  setPaused(paused: boolean): void;
  stats(): TownStats;
  dispose(): void;
}

export class TownWebGLUnavailable extends Error {
  constructor() {
    super("WebGL is not available.");
  }
}

interface LightPreset {
  az: number;
  el: number;
  sun: string;
  si: number;
  sky: string;
  gnd: string;
  hi: number;
  bg: string;
  emis: number;
  lamp: number;
}

const LIGHTS: Record<TownLight, LightPreset> = {
  dawn: { az: -72, el: 8, sun: "#ffb48c", si: 0.78, sky: "#c9bcd8", gnd: "#4a4038", hi: 0.48, bg: "#dcb8b0", emis: 0.45, lamp: 0.9 },
  morning: { az: -38, el: 32, sun: "#fff3e0", si: 1.0, sky: "#d6e6f2", gnd: "#6b6648", hi: 0.62, bg: "#b9cfd9", emis: 0, lamp: 0 },
  midday: { az: -12, el: 60, sun: "#fffaf0", si: 1.02, sky: "#d2e4f2", gnd: "#6b6648", hi: 0.66, bg: "#b4d2e6", emis: 0, lamp: 0 },
  golden: { az: 40, el: 24, sun: "#ffcb8a", si: 1.18, sky: "#d9cbd9", gnd: "#5c4a33", hi: 0.5, bg: "#d9bfa0", emis: 0.12, lamp: 0 },
  dusk: { az: 68, el: 9, sun: "#ff7a52", si: 0.42, sky: "#4a5890", gnd: "#1e1a2a", hi: 0.42, bg: "#2c3358", emis: 1, lamp: 2.2 },
  night: { az: 30, el: 38, sun: "#9fb4e8", si: 0.2, sky: "#26305a", gnd: "#10121c", hi: 0.3, bg: "#141a34", emis: 1, lamp: 2.8 },
};

// three's lights are physically based; the diorama was tuned under the old
// convention, which scaled light by π.
const PI = Math.PI;

interface Mixed {
  az: number;
  el: number;
  si: number;
  hi: number;
  emis: number;
  lamp: number;
  sun: Any;
  sky: Any;
  gnd: Any;
  bg: Any;
}

function mixLight(a: LightPreset | Mixed, b: LightPreset, t: number): Mixed {
  const colour = (from: string | Any, to: string) => new Color(from).lerp(new Color(to), t);
  const lerp = (x: number, y: number) => x + (y - x) * t;
  return {
    az: lerp(a.az, b.az),
    el: lerp(a.el, b.el),
    si: lerp(a.si, b.si),
    hi: lerp(a.hi, b.hi),
    emis: lerp(a.emis, b.emis),
    lamp: lerp(a.lamp, b.lamp),
    sun: colour(a.sun, b.sun),
    sky: colour(a.sky, b.sky),
    gnd: colour(a.gnd, b.gnd),
    bg: colour(a.bg, b.bg),
  };
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const DIVE_MS = 1500;
const SURFACE_MS = 1100;
const RUN_SPEED = 1.55;

export function createTownRenderer(options: TownRendererOptions): TownRenderer {
  const { host, plan } = options;
  ColorManagement.enabled = false;
  // A canvas of its own: a disposed renderer loses its context for good.
  const canvas = document.createElement("canvas");
  canvas.className = "overland-town-canvas";
  for (const [name, value] of Object.entries(options.canvasAttributes ?? {})) canvas.setAttribute(name, value);
  host.append(canvas);
  let renderer: Any;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "high-performance", stencil: false });
  } catch {
    canvas.remove();
    throw new TownWebGLUnavailable();
  }
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  const anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());

  const scene = new Scene();
  const built: TownScene = buildTownScene(plan, anisotropy);
  scene.add(built.root);
  const features = plan.trees.filter((tree) => tree.feature).length;

  // ---- lights
  const hemi = new HemisphereLight(0xffffff, 0x444444, 0.6 * PI);
  scene.add(hemi);
  const sun = new DirectionalLight(0xffffff, PI);
  sun.castShadow = true;
  const sc = sun.shadow.camera;
  sc.left = -22;
  sc.right = 22;
  sc.top = 22;
  sc.bottom = -22;
  sc.near = 1;
  sc.far = 90;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 2;
  scene.add(sun);
  scene.add(sun.target);
  const lamps = built.lampSpots.map(([x, y, z]) => {
    const light = new PointLight(0xffb060, 0, 6, 2);
    light.position.set(x, y, z);
    scene.add(light);
    return light;
  });
  scene.fog = new Fog(0xcccccc, 40, 90);

  // ---- state
  let width = 1;
  let height = 1;
  let reducedMotion = options.reducedMotion;
  let tier = options.tier;
  let paused = false;
  let disposed = false;
  const camera = new PerspectiveCamera(TOWN_FOV_DEG, 1, 0.5, 300);
  const orbit = { yaw: 0, pitch: 0, vy: 0, vp: 0, zoom: 1, drag: false };
  let idleT = 0;

  type Move = { from: TownPose; to: () => TownPose; start: number; duration: number; resolve: () => void } | null;
  let move: Move = null;
  let mode: "home" | "diving" | "dived" | "travel" | "surfacing" = "home";
  let pose: TownPose = homePose(1);
  let diveSlug: string | null = null;
  let diveOpening: { tiltDeg: number; fovDeg: number } | undefined;
  let travelStart = 0;
  let runnerX = 0;
  let trail: Array<[number, number]> = [];
  let trailOrigin = { x: 0, z: 0 };
  let highlighted: string | null = null;

  // ---- light
  let lightFrom: Mixed | null = null;
  let lightTo: LightPreset = LIGHTS[PLACE_DEFAULT_LIGHT];
  let lightT = 1;
  let lightNow: Mixed = mixLight(lightTo, lightTo, 0);
  const applyLight = (o: Mixed) => {
    const az = (o.az * Math.PI) / 180;
    const el = (o.el * Math.PI) / 180;
    const D = 50;
    sun.position.set(Math.sin(az) * Math.cos(el) * D, Math.sin(el) * D, 0.8 + Math.cos(az) * Math.cos(el) * D);
    sun.target.position.set(0, 0, 0.8);
    sun.color.copy(o.sun);
    sun.intensity = o.si * PI;
    hemi.color.copy(o.sky);
    hemi.groundColor.copy(o.gnd);
    hemi.intensity = o.hi * PI;
    scene.background = o.bg;
    scene.fog.color.copy(o.bg);
    for (const material of built.kit.emissive) material.emissiveIntensity = o.emis;
    for (const lamp of lamps) lamp.intensity = o.lamp * PI;
    if (built.lampMaterial) built.lampMaterial.color.setRGB(0.55 + o.emis * 0.45, 0.52 + o.emis * 0.3, 0.47);
    built.farPlane.material.color.set(plan.ground.far).lerp(o.bg, 0.25);
  };
  applyLight(lightNow);

  // ---- quality
  const applyQuality = () => {
    const settings = qualitySettings(tier, window.devicePixelRatio || 1);
    renderer.setPixelRatio(settings.pixelRatio);
    renderer.setSize(width, height, false);
    sun.castShadow = settings.shadowMapSize > 0;
    if (settings.shadowMapSize > 0 && sun.shadow.mapSize.x !== settings.shadowMapSize) {
      sun.shadow.mapSize.set(settings.shadowMapSize, settings.shadowMapSize);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    const keepRank = treesKept(plan.trees.length, features, settings.treeShare);
    for (const bucket of built.trees) {
      let count = 0;
      while (count < bucket.ranks.length && bucket.ranks[count] < keepRank) count += 1;
      bucket.mesh.count = count;
    }
    kick();
  };

  // ---- camera
  // A town on the coast looks a little further forward, to show the sea.
  const currentHome = () => {
    const home = homePose(width / height);
    return plan.water.kind === "shore" ? { ...home, target: { ...home.target, z: home.target.z + 1.4 } } : home;
  };
  const orbitPose = (base: TownPose): TownPose => ({
    ...base,
    yaw: base.yaw + orbit.yaw + (reducedMotion ? 0 : Math.sin(idleT * 0.35) * 0.025),
    pitchDeg: base.pitchDeg + orbit.pitch,
    distance: base.distance * orbit.zoom,
  });
  const placeCamera = (p: TownPose) => {
    const position = cameraPosition(p);
    camera.position.set(position.x, position.y, position.z);
    camera.lookAt(p.target.x, p.target.y, p.target.z);
    // Low over the town, the fog closes in so the ground never shows an edge.
    const low = Math.min(1, Math.max(0, (50 - p.pitchDeg) / 20));
    scene.fog.near = p.distance * (1.05 - 0.3 * low);
    scene.fog.far = p.distance * (2.6 - 0.75 * low);
  };
  const behindRunner = (): TownPose => {
    const sign = plan.signposts.find((candidate) => candidate.slug === diveSlug);
    if (!sign) return currentHome();
    const target = diveTarget({ x: mode === "travel" ? runnerX : sign.x, side: sign.side }, diveOpening, height);
    return target;
  };

  const stepOrbit = (dt: number) => {
    if (orbit.drag || mode !== "home") return false;
    const K = reducedMotion ? 60 : 14;
    const Cd = 2 * Math.sqrt(K) * 0.9;
    orbit.vy += (-K * orbit.yaw - Cd * orbit.vy) * dt;
    orbit.vp += (-K * orbit.pitch - Cd * orbit.vp) * dt;
    orbit.yaw = Math.max(-0.75, Math.min(0.75, orbit.yaw + orbit.vy * dt));
    orbit.pitch = Math.max(-16, Math.min(18, orbit.pitch + orbit.vp * dt));
    const moving = Math.abs(orbit.yaw) > 1e-4 || Math.abs(orbit.vy) > 1e-4 || Math.abs(orbit.pitch) > 1e-3 || Math.abs(orbit.vp) > 1e-3;
    if (!moving) orbit.yaw = orbit.pitch = orbit.vy = orbit.vp = 0;
    return moving;
  };

  // ---- input on the canvas: drag to look, wheel or pinch to zoom, arrows
  const pointers = new Map<number, [number, number]>();
  let pinch0 = 0;
  let zoom0 = 1;
  let lastX = 0;
  let lastY = 0;
  let lastT = 0;
  const clampZoom = (value: number) => Math.max(0.62, Math.min(1.35, value));
  const onDown = (event: PointerEvent) => {
    if (mode !== "home") return;
    canvas.setPointerCapture?.(event.pointerId);
    pointers.set(event.pointerId, [event.clientX, event.clientY]);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]);
      zoom0 = orbit.zoom;
    }
    orbit.drag = true;
    orbit.vy = orbit.vp = 0;
    lastX = event.clientX;
    lastY = event.clientY;
    lastT = performance.now();
    kick();
  };
  const onMove = (event: PointerEvent) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, [event.clientX, event.clientY]);
    if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch0 > 0) orbit.zoom = clampZoom((zoom0 * pinch0) / d);
      kick();
      return;
    }
    const now = performance.now();
    const dt = Math.max(1, now - lastT);
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    lastT = now;
    const k = 1 / Math.max(320, Math.min(width, 900));
    let ny = orbit.yaw - dx * k * 1.6;
    let np = orbit.pitch + dy * k * 30;
    if (Math.abs(ny) > 0.55) ny = orbit.yaw - dx * k * 0.4;
    if (np < -12 || np > 14) np = orbit.pitch + dy * k * 8;
    orbit.vy = ((ny - orbit.yaw) / dt) * 1000;
    orbit.vp = ((np - orbit.pitch) / dt) * 1000;
    orbit.yaw = ny;
    orbit.pitch = np;
    kick();
  };
  const onUp = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    if (pointers.size === 0) {
      orbit.drag = false;
      if (performance.now() - lastT > 80) orbit.vy = orbit.vp = 0;
    }
    pinch0 = 0;
    kick();
  };
  const onWheel = (event: WheelEvent) => {
    if (mode !== "home") return;
    event.preventDefault();
    orbit.zoom = clampZoom(orbit.zoom * Math.exp(event.deltaY * 0.0012));
    kick();
  };
  const onKey = (event: KeyboardEvent) => {
    if (mode !== "home") return;
    const key = event.key;
    if (key === "ArrowLeft") orbit.vy -= 0.9;
    else if (key === "ArrowRight") orbit.vy += 0.9;
    else if (key === "ArrowUp") orbit.vp -= 14;
    else if (key === "ArrowDown") orbit.vp += 14;
    else if (key === "+" || key === "=") orbit.zoom = clampZoom(orbit.zoom / 1.1);
    else if (key === "-") orbit.zoom = clampZoom(orbit.zoom * 1.1);
    else return;
    event.preventDefault();
    kick();
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("keydown", onKey);
  const onLost = (event: Event) => {
    event.preventDefault();
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    options.onContextLost?.();
  };
  canvas.addEventListener("webglcontextlost", onLost);

  // ---- the runner's loop
  const loop = plan.runnerLoop;
  const lengths = [0];
  for (let i = 1; i < loop.length; i += 1) lengths.push(lengths[i - 1] + Math.hypot(loop[i][0] - loop[i - 1][0], loop[i][1] - loop[i - 1][1]));
  const loopLength = lengths[lengths.length - 1];
  const along = (s: number) => {
    s = ((s % loopLength) + loopLength) % loopLength;
    let i = 1;
    while (i < lengths.length - 1 && lengths[i] < s) i += 1;
    const a = loop[i - 1];
    const b = loop[i];
    const f = (s - lengths[i - 1]) / (lengths[i] - lengths[i - 1] || 1);
    return { x: a[0] + (b[0] - a[0]) * f, z: a[1] + (b[1] - a[1]) * f, dx: b[0] - a[0], dz: b[1] - a[1] };
  };
  let runS = loopLength * (reducedMotion ? 0.97 : 0.995);
  let runFrame = 0;
  let runAcc = 0;
  let waterAcc = 0;
  /** Places the runner; (dx, dz) is the way she is actually running. */
  const poseRunner = (x: number, z: number, dx: number, dz: number, yaw: number, frame: number) => {
    built.runner.position.set(x, 0.02, z);
    built.runner.rotation.set(0, 0, 0);
    built.runner.rotation.y = yaw;
    built.runner.rotateX(-0.28);
    const facing: RunnerFacing = runnerFacing({ dx, dz }, yaw);
    const row = reducedMotion && mode === "home" ? 0 : RUNNER_ROWS[facing];
    built.runnerTexture.offset.set((reducedMotion ? 0 : frame) * 0.25, 1 - 0.25 * (row + 1));
  };

  // ---- signposts on screen
  const v = new Vector3();
  const v2 = new Vector3();
  const projections = (): SignProjection[] =>
    built.signs.map(({ sign, board }) => {
      board.getWorldPosition(v);
      v.project(camera);
      let x = (v.x * 0.5 + 0.5) * width;
      const y = (-v.y * 0.5 + 0.5) * height;
      v2.set(1, 0, 0);
      board.localToWorld(v2);
      v2.project(camera);
      const half = Math.abs((v2.x * 0.5 + 0.5) * width - x);
      const w = Math.min(Math.max(44, half * 2 + 8), width - 32);
      const h = Math.max(44, half * 0.9);
      const visible = mode === "home" && v.z < 1 && x > -20 && x < width + 20 && y > -20 && y < height + 20;
      x = Math.min(Math.max(x, 16 + w / 2), width - 16 - w / 2);
      return { slug: sign.slug, x, y, width: w, height: h, visible };
    });

  // ---- the loop
  let raf = 0;
  let lastFrame = 0;
  let readyAt = 0;
  const frameMs: number[] = [];
  const fps = { n: 0, t: 0, value: 0 };

  function animating() {
    return !reducedMotion || orbit.drag || lightT < 1 || move !== null || mode === "travel";
  }
  function kick() {
    if (!raf && !disposed && !paused && !document.hidden) raf = requestAnimationFrame(tick);
  }
  function tick(now: number) {
    raf = 0;
    const dt = lastFrame ? Math.min(0.05, (now - lastFrame) / 1000) : 0.016;
    lastFrame = now;
    const orbitMoving = stepOrbit(dt);
    if (lightT < 1 && lightFrom) {
      lightT = Math.min(1, lightT + dt / 1.2);
      lightNow = mixLight(lightFrom, lightTo, ease(lightT));
      applyLight(lightNow);
    }
    if (!reducedMotion) {
      idleT += dt;
      waterAcc += dt;
      if (waterAcc > 0.16) {
        waterAcc = 0;
        for (const texture of built.waterTextures) texture.offset.x = (texture.offset.x + 1 / 32) % 1;
      }
      runAcc += dt;
      if (runAcc > 0.11) {
        runAcc = 0;
        runFrame = (runFrame + 1) % 4;
      }
    }
    // Camera
    if (move) {
      const t = Math.min(1, (now - move.start) / move.duration);
      pose = mixPose(move.from, move.to(), ease(t));
      if (t >= 1) {
        const done = move.resolve;
        move = null;
        done();
      }
    } else if (mode === "home") {
      pose = currentHome();
    } else {
      pose = behindRunner();
    }
    const shown = mode === "home" || mode === "surfacing" ? orbitPose(pose) : pose;
    placeCamera(shown);
    // Runner
    if (mode === "home" || mode === "surfacing") {
      if (!reducedMotion) runS -= dt * RUN_SPEED;
      const p = along(runS);
      // She runs the loop backwards along its points, so her way is against them.
      poseRunner(p.x, p.z, -p.dx, -p.dz, shown.yaw, runFrame);
    } else {
      const sign = plan.signposts.find((candidate) => candidate.slug === diveSlug);
      if (sign) {
        if (mode === "travel" && !reducedMotion) runnerX += sign.side * dt * RUN_SPEED * 1.4;
        poseRunner(runnerX, 9.3, sign.side, 0, shown.yaw, runFrame);
        if (mode === "travel") drawTrail(now);
      }
    }
    renderer.render(scene, camera);
    options.onFrame?.(projections());
    fps.n += 1;
    if (now - fps.t > 1000) {
      fps.value = (fps.n * 1000) / (now - fps.t);
      fps.n = 0;
      fps.t = now;
    }
    // Judge the frame rate only once the town has settled, and not mid-move.
    if (!reducedMotion && now - readyAt > 1500 && move === null && tier !== "low") {
      frameMs.push(dt * 1000);
      if (frameMs.length >= FRAME_WINDOW) {
        const verdict = judgeFrames(frameMs, tier);
        frameMs.length = 0;
        if (verdict.tier !== tier) {
          tier = verdict.tier;
          applyQuality();
          options.onQualityLowered?.(tier);
        }
      }
    }
    if (animating() || orbitMoving) kick();
  }

  let trailShare = 0;
  let lastTrailDraw = 0;
  function drawTrail(now: number) {
    const elapsed = (now - travelStart) / 1000;
    const share = reducedMotion ? 1 : 1 - Math.exp(-elapsed / 2.2);
    if (share - trailShare < 0.01 && now - lastTrailDraw < 500) return;
    trailShare = share;
    lastTrailDraw = now;
    const half = TRAIL_SIZE / 2;
    const toTexel = (x: number, z: number): [number, number] => [(x - (trailOrigin.x - half)) * TRAIL_TEXELS, (z - (trailOrigin.z - half)) * TRAIL_TEXELS];
    paintTrail(built.trailCanvas, trail, toTexel, share);
    built.trailTexture.needsUpdate = true;
  }

  const onVisibility = () => {
    if (document.hidden) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    } else {
      lastFrame = 0;
      kick();
    }
  };
  document.addEventListener("visibilitychange", onVisibility);

  const startMove = (to: () => TownPose, duration: number) =>
    new Promise<void>((resolve) => {
      const from = orbitPose(pose);
      orbit.yaw = orbit.pitch = orbit.vy = orbit.vp = 0;
      orbit.zoom = 1;
      if (move) move.resolve();
      if (reducedMotion || duration === 0) {
        pose = to();
        move = null;
        kick();
        resolve();
        return;
      }
      move = { from, to, start: performance.now(), duration, resolve };
      kick();
    });

  applyQuality();
  readyAt = performance.now();

  const api: TownRenderer = {
    canvas,
    resize(nextWidth, nextHeight) {
      width = Math.max(1, nextWidth);
      height = Math.max(1, nextHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      applyQuality();
    },
    setReducedMotion(reduced) {
      reducedMotion = reduced;
      kick();
    },
    setLight(light, instant = false) {
      const target = LIGHTS[light] ?? LIGHTS[PLACE_DEFAULT_LIGHT];
      if (target === lightTo && lightT >= 1) return;
      lightFrom = lightNow;
      lightTo = target;
      lightT = instant || reducedMotion ? 1 : 0;
      if (lightT >= 1) {
        lightNow = mixLight(target, target, 0);
        applyLight(lightNow);
      }
      kick();
    },
    highlight(slug) {
      highlighted = slug;
      for (const { sign, board } of built.signs) board.scale.setScalar(sign.slug === highlighted ? 1.08 : 1);
      kick();
    },
    dive(slug, opening) {
      const sign = plan.signposts.find((candidate) => candidate.slug === slug);
      if (!sign) return Promise.resolve();
      diveSlug = slug;
      diveOpening = opening;
      runnerX = sign.x + sign.side * 0.6;
      mode = "diving";
      return startMove(behindRunner, DIVE_MS).then(() => {
        if (mode === "diving") mode = "dived";
      });
    },
    finish() {
      if (!move) return;
      const done = move.resolve;
      pose = move.to();
      move = null;
      done();
      kick();
    },
    travel(points) {
      const sign = plan.signposts.find((candidate) => candidate.slug === diveSlug);
      if (!sign) return;
      if (move) api.finish();
      mode = "travel";
      travelStart = performance.now();
      trailShare = 0;
      trail = points && points.length > 1 ? trailOnGround(points, { x: runnerX + sign.side * 2.4, z: 9.3 }, sign.side, TRAIL_SIZE / 2 - 3) : [];
      trailOrigin = { x: runnerX + sign.side * (TRAIL_SIZE / 2 - 1), z: 9.3 };
      built.trailMesh.position.set(trailOrigin.x, 0.05, trailOrigin.z);
      built.trailMesh.visible = trail.length > 1;
      kick();
    },
    surface() {
      mode = "surfacing";
      built.trailMesh.visible = false;
      return startMove(currentHome, SURFACE_MS).then(() => {
        mode = "home";
        diveSlug = null;
        kick();
      });
    },
    setPaused(next) {
      paused = next;
      if (paused && raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      } else {
        lastFrame = 0;
        kick();
      }
    },
    stats() {
      const treesDrawn = treesKept(plan.trees.length, features, qualitySettings(tier, window.devicePixelRatio || 1).treeShare);
      return { fps: fps.value, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, tier, trees: plan.trees.length, treesDrawn };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (move) move.resolve();
      move = null;
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("keydown", onKey);
      canvas.removeEventListener("webglcontextlost", onLost);
      scene.traverse((object: Any) => {
        object.geometry?.dispose?.();
        const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
        for (const material of materials) {
          for (const value of Object.values(material)) if ((value as Any)?.isTexture) (value as Any).dispose();
          material.dispose();
        }
      });
      for (const item of built.kit.disposables) (item as Any).dispose?.();
      sun.shadow.map?.dispose();
      renderer.renderLists.dispose();
      renderer.dispose();
      renderer.forceContextLoss?.();
      canvas.remove();
    },
  };
  return api;
}

export default createTownRenderer;
