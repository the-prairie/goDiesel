import type { GoogleRouteCameraPose } from "@/surfaces/replay/playback/route-navigator-controller";

export interface RouteCameraMotionState {
  pose: GoogleRouteCameraPose;
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
): RouteCameraMotionState {
  const elapsed = Math.min(0.1, Math.max(0, elapsedSeconds));
  // Mode changes can share a timestamp with the animation frame. No time
  // elapsed means no integration (and avoids Infinity * 0 for unbounded axes).
  if (elapsed === 0) return state;
  const headingTarget =
    state.pose.headingDeg +
    (((desired.headingDeg - state.pose.headingDeg + 540) % 360) - 180);
  const lat = smoothDamp(
    state.pose.center.lat,
    desired.center.lat,
    state.velocity.lat,
    elapsed,
    responseSeconds,
  );
  const lng = smoothDamp(
    state.pose.center.lng,
    desired.center.lng,
    state.velocity.lng,
    elapsed,
    responseSeconds,
  );
  const altitude = smoothDamp(
    state.pose.center.altitude ?? desired.center.altitude ?? 0,
    desired.center.altitude ?? state.pose.center.altitude ?? 0,
    state.velocity.altitude,
    elapsed,
    responseSeconds,
  );
  const heading = smoothDamp(
    state.pose.headingDeg,
    headingTarget,
    state.velocity.heading,
    elapsed,
    Math.max(1.25, responseSeconds),
    30,
    45,
  );
  const range = smoothDamp(
    state.pose.rangeM,
    desired.rangeM,
    state.velocity.range,
    elapsed,
    Math.max(0.8, responseSeconds),
  );
  const tilt = smoothDamp(
    state.pose.tiltDeg,
    desired.tiltDeg,
    state.velocity.tilt,
    elapsed,
    Math.max(1.1, responseSeconds),
    10,
    18,
  );
  const fov = smoothDamp(
    state.pose.fovDeg,
    desired.fovDeg,
    state.velocity.fov,
    elapsed,
    responseSeconds,
  );
  const progress = smoothDamp(
    state.pose.progressM,
    desired.progressM,
    state.velocity.progress,
    elapsed,
    responseSeconds,
  );

  return {
    pose: {
      ...desired,
      center: {
        lat: lat.value,
        lng: lng.value,
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

function smoothDamp(
  current: number,
  target: number,
  velocity: number,
  elapsedSeconds: number,
  responseSeconds: number,
  maxSpeed = Infinity,
  maxAcceleration = Infinity,
) {
  const smoothTime = Math.max(0.12, responseSeconds);
  const omega = 2 / smoothTime;
  const x = omega * elapsedSeconds;
  const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = current - target;
  const temporary = (velocity + omega * change) * elapsedSeconds;
  const nextVelocity = (velocity - omega * temporary) * decay;
  const boundedVelocity = Math.max(-maxSpeed, Math.min(maxSpeed,
    Math.max(velocity - maxAcceleration * elapsedSeconds,
      Math.min(velocity + maxAcceleration * elapsedSeconds, nextVelocity))));
  // Integrate bounded angular velocity rather than clipping the position: turns
  // retain momentum through changing GPS bearings without a visible snap.
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
      lng: interpolate(current.center.lng, desired.center.lng, amount),
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
