import { GOOGLE_ROUTE_REPLAY_DURATION_SECONDS } from "@/surfaces/replay/playback/route-navigator-controller";

/** Frames a second of the walk cycle at normal playback speed. */
export const WALK_FPS = 8;

/**
 * The sprite frame for a point on the route. It is read from progress, not
 * the clock, so the runner walks only while the replay moves: it holds
 * still when paused, steps with a scrub, and quickens with speed.
 */
export function walkFrame({
  progressM,
  totalDistanceM,
  frames,
  reducedMotion,
}: {
  progressM: number;
  totalDistanceM: number;
  frames: number;
  reducedMotion: boolean;
}) {
  if (reducedMotion || totalDistanceM <= 0 || frames <= 1) return 0;
  const seconds = (progressM / totalDistanceM) * GOOGLE_ROUTE_REPLAY_DURATION_SECONDS;
  return Math.floor(seconds * WALK_FPS) % frames;
}
