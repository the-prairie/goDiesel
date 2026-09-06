import { LoadRegionPlugin, SphereRegion } from "3d-tiles-renderer/three/plugins";
import type { TilesRenderer } from "3d-tiles-renderer/three";
import type { QuestRoute } from "@/domain/route";
import { routeDistanceM, routePathPose } from "@/domain/geometry/route-path";
import { WorldFrame } from "./world-frame";
import type { WorldPlaybackContext } from "./world-diagnostics";

/** Speculative work is always smaller than the visible scene and never crosses a recorded gap. */
export function planWorldLookAhead(route: QuestRoute, context: WorldPlaybackContext | null, rangeM: number, pending: number, cacheFraction: number, seeking: boolean) {
  if (route.elevationStatus === "unavailable" || !context?.following || rangeM > 2500 || pending >= 16 || cacheFraction >= 0.92) return null;
  if (!context.playing && !seeking) return null;
  const distance = seeking ? 0 : Math.min(320, routeDistanceM(route) / 210 * context.speed * 1.5);
  const progressM = Math.min(routeDistanceM(route), context.progressM + distance);
  if (route.provenance.discontinuities.some(gap => context.progressM < gap.endD && progressM > gap.startD || gap.startD === gap.endD && context.progressM < gap.startD && progressM >= gap.endD)) return null;
  return { progressM, radiusM: Math.max(60, Math.min(180, rangeM * 0.4)), mode: seeking ? "destination" as const : "ahead" as const };
}

/**
 * One non-masking load sphere in the tileset's ECEF coordinates. A route-aware
 * hint, not a second world, camera, persistent tile cache or fabricated geometry.
 * Infinity region distance leaves actual camera requests ahead in the queue.
 */
export class WorldLookAhead {
  private readonly plugin = new LoadRegionPlugin();
  private readonly region = new SphereRegion();
  private nextUpdate = 0;
  private latestSeek = -Infinity;
  private attached = false;
  mode: "off" | "ahead" | "destination" = "off";
  progressM: number | null = null;
  constructor(private readonly tiles: TilesRenderer, private readonly route: QuestRoute, private readonly frame: WorldFrame) {
    tiles.registerPlugin(this.plugin);
  }
  seek(now: number) { this.latestSeek = now; this.nextUpdate = now + 90; this.clear(); }
  update(now: number, context: WorldPlaybackContext | null, rangeM: number, fov: number, height: number, pending: number) {
    if (!context?.following) { this.clear(); return; }
    if (now < this.nextUpdate) return;
    // Refresh at most twice per second; don't chase each smoothed camera pixel.
    this.nextUpdate = now + 500;
    const seeking = now - this.latestSeek < 1200;
    const plan = planWorldLookAhead(this.route, context, rangeM, pending, (this.tiles.lruCache as unknown as { cachedBytes: number }).cachedBytes / this.tiles.lruCache.maxBytesSize, seeking);
    if (!plan) { this.clear(); return; }
    const point = routePathPose(this.route, plan.progressM);
    // Without recorded elevation the planner disables speculation, rather than
    // spending the terrain budget searching a guessed sea-level corridor.
    this.region.sphere.center.copy(this.frame.position(point.lat, point.lng, point.elev)).applyMatrix4(this.frame.worldToECEF);
    this.region.sphere.radius = plan.radiusM;
    this.region.errorTarget = Math.max(2, rangeM * 2 * Math.tan(fov * Math.PI / 360) / Math.max(1, height) * this.tiles.errorTarget);
    if (!this.attached) { this.plugin.addRegion(this.region); this.attached = true; }
    this.mode = plan.mode; this.progressM = plan.progressM;
  }
  private clear() {
    if (this.attached) this.plugin.removeRegion(this.region);
    this.attached = false; this.mode = "off"; this.progressM = null;
  }
  dispose() { this.clear(); this.tiles.unregisterPlugin(this.plugin); }
}
