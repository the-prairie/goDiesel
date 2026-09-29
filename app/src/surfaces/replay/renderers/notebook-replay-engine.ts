import { LngLatBounds } from "maplibre-gl";
import { ReliefWorld, takeReliefWorld, type ReliefState } from "@/ui/maps/relief-world";
import { carriedLift, needsSightlineResample, reliefCamera, reliefCameraFollow } from "@/ui/maps/relief-camera";
import type { ReplayEngine, ReplayEngineMountOptions, ReplayMark } from "@/surfaces/replay/renderer-port";
import type { ReplayPose } from "@/surfaces/replay/playback/replay-controller";

/** A renderer adapter for the existing Replay controller and dock. */
export class NotebookReplayEngine implements ReplayEngine {
  private world?: ReliefWorld;
  private route?: ReplayEngineMountOptions["route"];
  private unsubscribe?: () => void;
  private firstPose = true;
  private carried = false;
  private previous?: ReplayPose;
  private bottomInset = 0;
  private sample?: { progressM: number; atMs: number; scale: number };
  private sampledLift?: number;
  private lift?: number;

  async mount({ container, route, onStatus }: ReplayEngineMountOptions) {
    this.route = route;
    const saved = takeReliefWorld(route.slug);
    this.carried = !!saved;
    const bounds = new LngLatBounds();
    route.route.forEach(p => bounds.extend([p.lng, p.lat]));
    const world = saved ?? new ReliefWorld(container, {
      bounds, fitBoundsOptions: { padding: 100, animate: false }, pitch: 54,
    });
    this.world = world;
    world.attach(container);
    world.explore(false);
    world.map.setCenterClampedToGround(false);
    if (!saved) world.setRoutes([{ slug: route.slug, trace: route.route }], route.slug, route.route, route.provenance.discontinuities);
    world.host.dataset.renderer = "notebook-terrain";
    world.host.dataset.carried = String(this.carried);
    this.unsubscribe = world.subscribe((state: ReliefState) => {
      world.host.dataset.terrainState = state;
      onStatus({ state,
        title: state === "ready" ? "The landscape is ready" : state === "partial" ? "Some elevation tiles are unavailable" : state === "unavailable" ? "The landscape could not load" : "The land is taking shape",
        message: state === "ready" ? "Continue along the recorded route." : state === "partial" ? "The recorded route remains available; terrain detail is incomplete." : "Loading the route and its terrain.",
      });
    });
  }

  setPose(pose: ReplayPose) {
    const world = this.world, route = this.route;
    if (!world || !route) return;
    world.setProgress(pose.progressM);
    world.explore(!pose.following);
    if (!pose.following) { this.previous = pose; return; }
    const samePosition = this.previous?.progressM === pose.progressM && this.previous.cameraRangeM === pose.cameraRangeM && this.previous.following;
    if (samePosition) return;
    // The first Replay frame is the descent's last frame, including its loaded
    // terrain. No fitBounds, new camera, or zero-distance pose during handover.
    if (!(this.firstPose && this.carried)) {
      const scale = Math.sqrt(pose.cameraRangeM / 240);
      const gaps = route.provenance.discontinuities;
      const now = performance.now();
      const firstBearing = world.viewBearing === undefined;
      // Full sightline sample only when the ground ahead may have changed;
      // frames in between carry its lift (relief-camera.ts).
      if (firstBearing || this.sample?.scale !== scale || needsSightlineResample(this.sample, pose.progressM, now)) {
        const sampled = reliefCamera(world.map, route.route, pose.progressM, gaps, scale, world.viewBearing);
        if (sampled) {
          world.viewBearing ??= sampled.options.bearing;
          this.sample = { progressM: pose.progressM, atMs: now, scale };
          this.sampledLift = sampled.eyeElevation - sampled.targetElevation;
          world.host.dataset.cameraSamples = String(sampled.sampled);
        }
      }
      if (this.sampledLift !== undefined && world.viewBearing !== undefined) {
        this.lift = carriedLift(this.lift, this.sampledLift);
        const camera = reliefCameraFollow(world.map, route.route, pose.progressM, gaps, scale, world.viewBearing, this.lift);
        if (camera) {
          world.map.jumpTo({ ...camera.options, padding: { top: 80, right: 0, left: 0, bottom: this.bottomInset } });
          world.host.dataset.cameraEyeElevation = camera.eyeElevation.toFixed(1);
        }
      }
    }
    this.firstPose = false;
    this.previous = pose;
  }

  setBottomInset(pixels: number) {
    const inset = Math.max(0, Math.round(pixels));
    if (inset === this.bottomInset) return;
    this.bottomInset = inset;
    const last = this.previous;
    this.previous = undefined;
    if (last) this.setPose(last);
  }

  setMarks(marks: ReplayMark[]) {
    this.world?.setMarks(marks);
  }

  destroy() {
    this.unsubscribe?.();
    this.world?.destroy();
    this.world = undefined;
    this.previous = undefined;
    this.sample = undefined;
    this.sampledLift = undefined;
    this.lift = undefined;
  }
}
