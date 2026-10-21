import type { GoogleRouteCameraPose } from "@/surfaces/replay/playback/route-navigator-controller";
import { interpolateLongitude, normalizeLongitude, shortestLongitudeDelta } from "@/domain/geometry/longitude";

export interface RouteCameraMotionState {
  pose: GoogleRouteCameraPose;
  target: GoogleRouteCameraPose;
  velocity: {
    altitude: number;
    fov: number;
    heading: number;
    lat: number;
    lng: number;
    progress: number;
    range: number;
    tilt: number;
  };
}

export function createRouteCameraMotionState(
  pose: GoogleRouteCameraPose,
): RouteCameraMotionState {
  return {
    pose,
    target: pose,
    velocity: {
      altitude: 0,
      fov: 0,
      heading: 0,
      lat: 0,
      lng: 0,
      progress: 0,
      range: 0,
      tilt: 0,
    },
  };
}

export function advanceRouteCameraMotion(
  state: RouteCameraMotionState,
  desired: GoogleRouteCameraPose,
  elapsedSeconds: number,
  responseSeconds = 0.48,
  movement: "transition" | "tracking" = "transition",
): RouteCameraMotionState {
  const elapsed = Math.min(0.1, Math.max(0, elapsedSeconds));
  if (elapsed === 0) return { ...state, target: desired };
  const targetVelocity = (current: number, previous: number) =>
    movement === "tracking" ? (current - previous) / elapsed : 0;
  const headingTarget =
    state.pose.headingDeg +
    (((desired.headingDeg - state.pose.headingDeg + 540) % 360) - 180);
  const lat = smoothDamp(
    state.pose.center.lat,
    desired.center.lat,
    state.velocity.lat,
    elapsed,
    responseSeconds,
    targetVelocity(desired.center.lat, state.target.center.lat),
  );
  const lng = smoothDamp(
    state.pose.center.lng,
    state.pose.center.lng + shortestLongitudeDelta(state.pose.center.lng, desired.center.lng),
    state.velocity.lng,
    elapsed,
    responseSeconds,
    movement === "tracking" ? shortestLongitudeDelta(state.target.center.lng, desired.center.lng) / elapsed : 0,
  );
  const altitude = smoothDamp(
    state.pose.center.altitude ?? desired.center.altitude ?? 0,
    desired.center.altitude ?? state.pose.center.altitude ?? 0,
    state.velocity.altitude,
    elapsed,
    responseSeconds,
    targetVelocity(desired.center.altitude ?? 0, state.target.center.altitude ?? 0),
  );
  const heading = smoothDamp(
    state.pose.headingDeg,
    headingTarget,
    state.velocity.heading,
    elapsed,
    Math.max(1.25, responseSeconds),
    movement === "tracking"
      ? (((desired.headingDeg - state.target.headingDeg + 540) % 360) - 180) / elapsed
      : 0,
    30,
    45,
  );
  const range = smoothDamp(
    state.pose.rangeM,
    desired.rangeM,
    state.velocity.range,
    elapsed,
    Math.max(0.8, responseSeconds),
    targetVelocity(desired.rangeM, state.target.rangeM),
  );
  const tilt = smoothDamp(
    state.pose.tiltDeg,
    desired.tiltDeg,
    state.velocity.tilt,
    elapsed,
    Math.max(1.1, responseSeconds),
    targetVelocity(desired.tiltDeg, state.target.tiltDeg),
    10,
    18,
  );
  const fov = smoothDamp(
    state.pose.fovDeg,
    desired.fovDeg,
    state.velocity.fov,
    elapsed,
    responseSeconds,
    targetVelocity(desired.fovDeg, state.target.fovDeg),
  );
  const progress = smoothDamp(
    state.pose.progressM,
    desired.progressM,
    state.velocity.progress,
    elapsed,
    responseSeconds,
    targetVelocity(desired.progressM, state.target.progressM),
  );

  return {
    target: desired,
    pose: {
      ...desired,
      center: {
        lat: lat.value,
        lng: normalizeLongitude(lng.value),
        altitude:
          desired.center.altitude === undefined ? undefined : altitude.value,
      },
      fovDeg: fov.value,
      headingDeg: (heading.value + 360) % 360,
      progressM: progress.value,
      rangeM: range.value,
      tiltDeg: tilt.value,
    },
    velocity: {
      altitude: altitude.velocity,
      fov: fov.velocity,
      heading: heading.velocity,
      lat: lat.velocity,
      lng: lng.velocity,
      progress: progress.velocity,
      range: range.velocity,
      tilt: tilt.velocity,
    },
  };
}

export function routeCameraMotionHasSettled(state: RouteCameraMotionState) {
  const { pose, target, velocity } = state;
  const headingDelta = Math.abs(((target.headingDeg - pose.headingDeg + 540) % 360) - 180);
  return (
    Math.abs(pose.center.lat - target.center.lat) < 0.000_001 &&
    Math.abs(shortestLongitudeDelta(pose.center.lng, target.center.lng)) < 0.000_001 &&
    Math.abs((pose.center.altitude ?? target.center.altitude ?? 0) -
      (target.center.altitude ?? pose.center.altitude ?? 0)) < 0.5 &&
    headingDelta < 0.2 &&
    Math.abs(pose.rangeM - target.rangeM) < 1.5 &&
    Math.abs(pose.tiltDeg - target.tiltDeg) < 0.1 &&
    Math.abs(pose.fovDeg - target.fovDeg) < 0.1 &&
    Math.abs(velocity.lat) < 0.000_001 &&
    Math.abs(velocity.lng) < 0.000_001 &&
    Math.abs(velocity.altitude) < 0.1 &&
    Math.abs(velocity.range) < 0.5 &&
    Math.abs(velocity.heading) < 0.1 &&
    Math.abs(velocity.tilt) < 0.1 &&
    Math.abs(velocity.fov) < 0.1
  );
}

function smoothDamp(
  current: number,
  target: number,
  velocity: number,
  elapsedSeconds: number,
  responseSeconds: number,
  targetVelocity: number,
  maxSpeed = Infinity,
  maxAcceleration = Infinity,
) {
  const smoothTime = Math.max(0.12, responseSeconds);
  const omega = 2 / smoothTime;
  const x = omega * elapsedSeconds;
  const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = current - (target - targetVelocity * elapsedSeconds);
  const relativeVelocity = velocity - targetVelocity;
  const temporary = (relativeVelocity + omega * change) * elapsedSeconds;
  const nextVelocity = targetVelocity + (relativeVelocity - omega * temporary) * decay;
  const boundedVelocity = Math.max(-maxSpeed, Math.min(maxSpeed,
    Math.max(velocity - maxAcceleration * elapsedSeconds,
      Math.min(velocity + maxAcceleration * elapsedSeconds, nextVelocity))));
  return {
    value: Number.isFinite(maxSpeed)
      ? current + (velocity + boundedVelocity) * 0.5 * elapsedSeconds
      : target + (change + temporary) * decay,
    velocity: boundedVelocity,
  };
}

function interpolate(start: number, end: number, amount: number) {
  return start + (end - start) * amount;
}

function interpolateHeading(start: number, end: number, amount: number) {
  const delta = ((end - start + 540) % 360) - 180;
  return (start + delta * amount + 360) % 360;
}

export function stabilizeRouteCamera(
  current: GoogleRouteCameraPose,
  desired: GoogleRouteCameraPose,
  elapsedSeconds: number,
  responseSeconds = 0.2,
): GoogleRouteCameraPose {
  const amount =
    1 -
    Math.exp(
      -Math.max(0, elapsedSeconds) / Math.max(0.08, responseSeconds),
    );
  return {
    ...desired,
    center: {
      lat: interpolate(current.center.lat, desired.center.lat, amount),
      lng: interpolateLongitude(current.center.lng, desired.center.lng, amount),
      altitude:
        desired.center.altitude === undefined
          ? undefined
          : interpolate(
              current.center.altitude ?? desired.center.altitude,
              desired.center.altitude,
              amount,
            ),
    },
    fovDeg: interpolate(current.fovDeg, desired.fovDeg, amount),
    headingDeg: interpolateHeading(
      current.headingDeg,
      desired.headingDeg,
      amount,
    ),
    progressM: interpolate(current.progressM, desired.progressM, amount),
    rangeM: interpolate(current.rangeM, desired.rangeM, amount),
    tiltDeg: interpolate(current.tiltDeg, desired.tiltDeg, amount),
  };
}
