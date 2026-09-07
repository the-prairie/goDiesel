import { LngLatBounds } from "maplibre-gl";
import { ReliefWorld, takeReliefWorld, type ReliefState } from "@/ui/maps/relief-world";
import { reliefCamera } from "@/ui/maps/relief-camera";
import type { ReplayEngine, ReplayEngineMountOptions } from "@/surfaces/replay/renderer-port";
import type { ReplayPose } from "@/surfaces/replay/playback/replay-controller";

/** A renderer adapter for the existing Replay controller and dock. */
export class NotebookReplayEngine implements ReplayEngine {
  private world?: ReliefWorld;
  private route?: ReplayEngineMountOptions["route"];
  private unsubscribe?: () => void;
  private firstPose = true;
  private carried = false;
  private previous?: ReplayPose;

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
      const camera = reliefCamera(world.map, route.route, pose.progressM, route.provenance.discontinuities, scale, world.viewBearing);
      if (camera) {
        world.viewBearing ??= camera.options.bearing;
        world.map.jumpTo(camera.options);
        world.host.dataset.cameraEyeElevation = camera.eyeElevation.toFixed(1);
        world.host.dataset.cameraSamples = String(camera.sampled);
      }
    }
    this.firstPose = false;
    this.previous = pose;
  }

  destroy() {
    this.unsubscribe?.();
    this.world?.destroy();
    this.world = undefined;
    this.previous = undefined;
  }
}
