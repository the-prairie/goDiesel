import { describe, expect, it } from "vitest";

import { TOWN_FOV_DEG, cameraPosition, diveTarget, homePose, mixPose, realmSpriteScale, trailOnGround } from "@/labs/overland/model/town-camera";

describe("homePose", () => {
  it("frames the town wider on a landscape screen and from higher on a phone", () => {
    const desktop = homePose(1440 / 900);
    const phone = homePose(390 / 844);
    expect(desktop.pitchDeg).toBe(50);
    expect(phone.pitchDeg).toBe(63);
    expect(desktop.yaw).toBe(0);
    // The phone sees about 14 units across, the desktop about 29.
    const across = (pose: ReturnType<typeof homePose>, aspect: number) => 2 * Math.tan((TOWN_FOV_DEG * Math.PI) / 360) * aspect * pose.distance;
    expect(across(phone, 390 / 844)).toBeCloseTo(13.8, 1);
    expect(across(desktop, 1440 / 900)).toBeCloseTo(29, 1);
  });
});

describe("cameraPosition", () => {
  it("sits behind the target along the yaw, above it by the pitch", () => {
    const position = cameraPosition({ target: { x: 0, y: 0, z: 0 }, yaw: 0, pitchDeg: 90, distance: 10 });
    expect(position.y).toBeCloseTo(10);
    const level = cameraPosition({ target: { x: 1, y: 0, z: 2 }, yaw: Math.PI / 2, pitchDeg: 0, distance: 5 });
    expect(level).toEqual({ x: 6, y: 0, z: expect.closeTo(2) });
  });
});

describe("diveTarget", () => {
  const opening = { tiltDeg: 64, fovDeg: 32 };

  it("ends behind the runner at the sign, looking the way her route leaves, at Google's opening pitch", () => {
    const west = diveTarget({ x: -1.15, side: -1 }, opening, 844);
    expect(west.pitchDeg).toBeCloseTo(26);
    expect(west.yaw).toBeCloseTo(Math.PI / 2);
    expect(west.target.x).toBeLessThan(-1.15);
    const east = diveTarget({ x: 4.25, side: 1 }, opening, 844);
    expect(east.yaw).toBeCloseTo(-Math.PI / 2);
    expect(east.target.x).toBeGreaterThan(4.25);
  });

  it("stands far enough back that the runner is the size of the 3D world's sprite", () => {
    const pose = diveTarget({ x: 0, side: 1 }, opening, 844);
    // A 1.7-unit runner fills the sprite's 96 of the viewport's 844 CSS pixels.
    const pixels = (1.7 / (2 * Math.tan((TOWN_FOV_DEG * Math.PI) / 360) * pose.distance)) * 844;
    expect(pixels).toBeCloseTo(24 * realmSpriteScale(844), 0);
  });

  it("draws the 3D world's sprite at a whole-pixel scale, about a tenth of the screen tall", () => {
    expect(realmSpriteScale(844)).toBe(4);
    expect(realmSpriteScale(900)).toBe(4);
    expect(realmSpriteScale(600)).toBe(3);
    expect(realmSpriteScale(2000)).toBe(5);
  });

  it("keeps a sensible pitch when the opening camera is unknown or extreme", () => {
    expect(diveTarget({ x: 0, side: 1 }, undefined, 844).pitchDeg).toBe(30);
    expect(diveTarget({ x: 0, side: 1 }, { tiltDeg: 89, fovDeg: 32 }, 844).pitchDeg).toBe(12);
    expect(diveTarget({ x: 0, side: 1 }, { tiltDeg: 5, fovDeg: 32 }, 844).pitchDeg).toBe(70);
  });
});

describe("mixPose", () => {
  it("eases between poses and turns the short way round", () => {
    const a = { target: { x: 0, y: 0, z: 0 }, yaw: (170 * Math.PI) / 180, pitchDeg: 50, distance: 40 };
    const b = { target: { x: 10, y: 0, z: 0 }, yaw: (-170 * Math.PI) / 180, pitchDeg: 30, distance: 10 };
    expect(mixPose(a, b, 0)).toEqual(a);
    const end = mixPose(a, b, 1);
    expect(end.target.x).toBeCloseTo(10);
    expect(end.pitchDeg).toBeCloseTo(30);
    const middle = mixPose(a, b, 0.5);
    expect(Math.abs(Math.cos(middle.yaw) - -1)).toBeLessThan(1e-9);
  });
});

describe("trailOnGround", () => {
  it("lays her line flat ahead of the runner, starting at her feet, turned to the way she leaves", () => {
    // A straight route due north, left to the west on the town's ground.
    const points = [{ lat: 35, lng: 135 }, { lat: 35.01, lng: 135 }, { lat: 35.02, lng: 135 }];
    const trail = trailOnGround(points, { x: -1, z: 9.3 }, -1, 10);
    expect(trail[0]).toEqual([-1, 9.3]);
    const last = trail[trail.length - 1];
    expect(last[0]).toBeCloseTo(-11, 5);
    expect(last[1]).toBeCloseTo(9.3, 5);
  });

  it("is empty without points", () => {
    expect(trailOnGround([], { x: 0, z: 0 }, 1, 10)).toEqual([]);
  });
});
