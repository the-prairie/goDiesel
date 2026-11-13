// The town's camera: a target, a yaw, a pitch and a distance, as in the
// approved diorama. Yaw 0 looks from the front edge (+z) towards the back
// of town; pitch is degrees above the horizon.

export const TOWN_FOV_DEG = 32;
/** The runner's height in world units. */
export const RUNNER_HEIGHT = 1.7;

/**
 * The whole-pixel scale of her 16 × 24 sprite in the 3D world: about a
 * tenth of the screen's height, from 3× to 5×.
 */
export function realmSpriteScale(viewportHeight: number) {
  return Math.min(5, Math.max(3, Math.round((viewportHeight * 0.1) / 24)));
}
/** The town's front path, where the signposts stand and the runner leaves. */
export const FRONT_PATH_Z = 9.3;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface TownPose {
  target: Vec3;
  yaw: number;
  pitchDeg: number;
  distance: number;
}

const tanHalf = () => Math.tan((TOWN_FOV_DEG * Math.PI) / 360);

/** The home view: the whole town on a landscape screen, its heart on a phone. */
export function homePose(aspect: number): TownPose {
  const portrait = aspect < 0.8;
  const want = portrait ? 13.8 : aspect < 1.2 ? 22 : 29;
  return {
    target: { x: 0, y: 0, z: portrait ? 1.1 : 0.8 },
    yaw: 0,
    pitchDeg: 50 + (portrait ? 13 : 0),
    distance: want / 2 / (tanHalf() * aspect),
  };
}

export function cameraPosition({ target, yaw, pitchDeg, distance }: TownPose): Vec3 {
  const pitch = (pitchDeg * Math.PI) / 180;
  return {
    x: target.x + Math.sin(yaw) * Math.cos(pitch) * distance,
    y: target.y + Math.sin(pitch) * distance,
    z: target.z + Math.cos(yaw) * Math.cos(pitch) * distance,
  };
}

/**
 * Where the dive ends: behind the runner at the foot of the signpost,
 * looking the way her route leaves town, at the pitch of the 3D world's
 * opening camera, and far enough back that she is the size of the sprite
 * the 3D world will show. Pitch is kept between 12° and 70°.
 */
export function diveTarget(sign: { x: number; side: -1 | 1 }, opening: { tiltDeg: number; fovDeg: number } | undefined, viewportHeight: number): TownPose {
  const pitchDeg = opening ? Math.min(70, Math.max(12, Math.round(90 - opening.tiltDeg))) : 30;
  return {
    target: { x: sign.x + sign.side * 1.2, y: 0.8, z: FRONT_PATH_Z },
    yaw: sign.side < 0 ? Math.PI / 2 : -Math.PI / 2,
    pitchDeg,
    distance: (RUNNER_HEIGHT * viewportHeight) / (24 * realmSpriteScale(viewportHeight) * 2 * tanHalf()),
  };
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export function mixPose(a: TownPose, b: TownPose, t: number): TownPose {
  if (t <= 0) return a;
  const turn = Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw));
  return {
    target: { x: mix(a.target.x, b.target.x, t), y: mix(a.target.y, b.target.y, t), z: mix(a.target.z, b.target.z, t) },
    yaw: a.yaw + turn * t,
    pitchDeg: mix(a.pitchDeg, b.pitchDeg, t),
    // Distance moves in log space, so the approach does not rush at the end.
    distance: Math.exp(mix(Math.log(a.distance), Math.log(b.distance), t)),
  };
}

/**
 * Her route's line laid flat on the town's ground ahead of the runner: it
 * starts at her feet, its first bearing turned to the way she leaves town
 * (west for -1, east for 1), and its farthest point `length` units away.
 */
export function trailOnGround(points: ReadonlyArray<{ lat: number; lng: number }>, start: { x: number; z: number }, side: -1 | 1, length: number): Array<[number, number]> {
  if (points.length === 0) return [];
  const [first] = points;
  const cos = Math.cos((first.lat * Math.PI) / 180);
  const metres = points.map((point) => ({ east: (point.lng - first.lng) * cos * 111_320, north: (point.lat - first.lat) * 110_540 }));
  const lead = metres.find((point) => Math.hypot(point.east, point.north) >= 150) ?? metres[metres.length - 1];
  const bearing = Math.atan2(lead.east, lead.north);
  const along = { e: Math.sin(bearing), n: Math.cos(bearing) };
  const right = { e: Math.cos(bearing), n: -Math.sin(bearing) };
  const reach = Math.max(1e-6, ...metres.map((point) => Math.hypot(point.east, point.north)));
  const scale = length / reach;
  // In the town, forward is along x; the runner's right is -z going west, +z going east.
  return metres.map((point) => {
    const forward = (point.east * along.e + point.north * along.n) * scale;
    const across = (point.east * right.e + point.north * right.n) * scale;
    return [start.x + side * forward, start.z + side * across] as [number, number];
  });
}
