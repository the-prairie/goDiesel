import { describe, expect, it } from "vitest";
import { WorldRefinement } from "./world-refinement";
const full = (now: number) => ({ sampledAtMs: now, hits: 15, tested: 15, centerHit: true });
describe("coverage-first terrain selection", () => {
  it("establishes coverage, then restores the exact nominal target", () => {
    const p = new WorldRefinement(10);
    expect(p.errorTarget).toBe(80);
    for (const [now, error, target] of [[0,80,80],[500,80,40],[1000,40,40],[1500,40,20],[2000,20,20],[2500,20,10],[3000,10,10]]) {
      p.update(now, 20, full(now), error); expect(p.errorTarget).toBe(target);
    }
    expect(p.snapshot()).toMatchObject({phase:"settled",nominalTargetPx:10,selectionTargetPx:10});
  });
  it("does not certify a textured corner, expired sample, empty draw, or unknown detail", () => {
    const p = new WorldRefinement(10);
    for (let now=0;now<=5000;now+=500) {
      p.update(now, 20, {...full(now),hits:10},10);
      p.update(now, 20, full(now-1000),10);
      p.update(now, 0, full(now),10);
      p.update(now, 20, full(now),null);
    }
    expect(p.errorTarget).toBe(80);
  });
  it("waits for each intermediate frontier rather than rushing past a coarse hit", () => {
    const p = new WorldRefinement(10);
    p.update(0,10,full(0),80);p.update(500,10,full(500),80);
    expect(p.errorTarget).toBe(40);
    p.update(1000,10,full(1000),80);p.update(3000,10,full(3000),80);
    expect(p.errorTarget).toBe(40);
  });
  it("recovers persistent holes without reacting to a single replacement frame", () => {
    const p = new WorldRefinement(10);
    p.update(0,10,full(0),40);p.update(500,10,full(500),40);
    p.update(600,0,full(600),10);expect(p.errorTarget).toBe(40);
    p.update(700,10,full(700),40);expect(p.errorTarget).toBe(40);
    p.update(800,0,full(800),10);p.update(1300,0,full(1300),10);
    expect(p.errorTarget).toBe(80);
  });
  it("resets on a new destination and retains the user's quality target", () => {
    const p = new WorldRefinement(10);
    p.update(0,10,full(0),40);p.update(500,10,full(500),40);
    p.reset();expect(p.snapshot()).toMatchObject({phase:"coverage",nominalTargetPx:10,selectionTargetPx:80});
    p.setTarget(18);expect(p.errorTarget).toBe(96);
    p.setTarget(18);expect(p.snapshot().resets).toBe(2);
    expect(()=>p.setTarget(NaN)).toThrow();expect(()=>new WorldRefinement(0)).toThrow();
  });
});
