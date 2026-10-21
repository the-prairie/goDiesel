import { describe, expect, it } from "vitest";
import { advanceRouteCameraMotion, createRouteCameraMotionState, routeCameraMotionHasSettled } from "./route-camera-stabilizer";

const start = {
  center: { lat: 37, lng: -122, altitude: 50 },
  headingDeg: 350,
  tiltDeg: 50,
  rangeM: 500,
  fovDeg: 52,
  progressM: 0,
};
const headingError = (actual: number, desired: number) =>
  Math.abs(((actual - desired + 540) % 360) - 180);

describe("moving camera targets", () => {
  it("crosses the antimeridian without moving toward Greenwich and settles while paused", () => {
    let motion = createRouteCameraMotionState({ ...start, center: { ...start.center, lng: 179.999 } });
    const target = { ...start, center: { ...start.center, lng: -179.999 } };
    for (let frame = 0; frame < 600; frame += 1) {
      motion = advanceRouteCameraMotion(motion, target, 1 / 60);
      expect(Math.abs(motion.pose.center.lng)).toBeGreaterThan(179.998);
    }
    expect(motion.pose.center.lng).toBeCloseTo(-179.999, 6);
    expect(routeCameraMotionHasSettled(motion)).toBe(true);
  });

  it.each([30, 60, 120])("tracks without permanent spring lag at %i fps", (fps) => {
    let motion = createRouteCameraMotionState(start);
    for (let frame = 1; frame <= fps * 8; frame++) {
      const t = frame / fps;
      const desired = {
        ...start,
        headingDeg: (350 + t * 6) % 360,
        rangeM: 500 + t * 12,
        tiltDeg: 50 + t,
        progressM: t * 25,
      };
      const previous = motion;
      motion = advanceRouteCameraMotion(motion, desired, 1 / fps, .48, "tracking");
      expect(Math.abs(motion.velocity.heading - previous.velocity.heading) * fps).toBeLessThanOrEqual(45.001);
      expect(Math.abs(motion.velocity.heading)).toBeLessThanOrEqual(30.001);
      if (t > 5) {
        expect(Math.abs(motion.pose.rangeM - desired.rangeM)).toBeLessThan(1.5);
        expect(headingError(motion.pose.headingDeg, desired.headingDeg)).toBeLessThan(.5);
        expect(Math.abs(motion.pose.tiltDeg - desired.tiltDeg)).toBeLessThan(.5);
      }
    }
  });

  it("settles after pause, speed changes and reversed targets without breaking turn limits", () => {
    let motion = createRouteCameraMotionState(start);
    let distance = 0;
    let desired = start;
    for (let frame = 1; frame <= 60 * 24; frame++) {
      const seconds = frame / 60;
      const speed = seconds < 4 ? 1 : seconds < 8 ? 4 : seconds < 12 ? -2 : 0;
      distance += speed / 60;
      desired = { ...start, headingDeg: (350 + distance * 6) % 360, tiltDeg: 50 + distance, rangeM: 500 + distance * 12 };
      const previous = motion;
      motion = advanceRouteCameraMotion(motion, desired, 1 / 60, .48, speed ? "tracking" : "transition");
      expect(Math.abs(motion.velocity.heading)).toBeLessThanOrEqual(30);
      expect(Math.abs(motion.velocity.heading - previous.velocity.heading) * 60).toBeLessThanOrEqual(45.001);
      expect(Math.abs(motion.velocity.tilt)).toBeLessThanOrEqual(10);
      expect(Math.abs(motion.velocity.tilt - previous.velocity.tilt) * 60).toBeLessThanOrEqual(18.001);
      expect(Object.values(motion.velocity).every(Number.isFinite)).toBe(true);
    }
    expect(headingError(motion.pose.headingDeg, desired.headingDeg)).toBeLessThan(.05);
    expect(Math.abs(motion.pose.rangeM - desired.rangeM)).toBeLessThan(.05);
    expect(Math.abs(motion.pose.tiltDeg - desired.tiltDeg)).toBeLessThan(.05);
    expect(Math.abs(motion.velocity.heading)).toBeLessThan(.05);
  });

  it("does not turn a zero-time seek into target velocity on the next playback frame", () => {
    const destination = { ...start, rangeM: 3000, headingDeg: 170 };
    const initial = createRouteCameraMotionState(start);
    const sought = advanceRouteCameraMotion(initial, destination, 0);
    expect(sought.pose).toEqual(initial.pose);
    const tracked = advanceRouteCameraMotion(sought, destination, 1 / 60, .48, "tracking");
    const transitioned = advanceRouteCameraMotion(initial, destination, 1 / 60);
    expect(tracked.pose).toEqual(transitioned.pose);
    expect(tracked.velocity).toEqual(transitioned.velocity);
  });
  it("does not declare a passing target settled while the camera still has momentum", () => {
    const motion = createRouteCameraMotionState(start);
    expect(routeCameraMotionHasSettled(motion)).toBe(true);
    for (const axis of ["lat", "lng", "altitude", "range", "heading", "tilt", "fov"] as const) {
      expect(routeCameraMotionHasSettled({ ...motion, velocity: { ...motion.velocity, [axis]: 1 } })).toBe(false);
    }
  });

});
