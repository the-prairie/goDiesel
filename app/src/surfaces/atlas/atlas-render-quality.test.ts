import { describe, expect, it } from 'vitest';
import { atlasOrbitalPitchLimit, atlasResolutionScale } from './atlas-render-quality';

describe('Atlas render resolution', () => {
  it('supersamples Retina phones without multiplying by the full device ratio', () => {
    expect(atlasResolutionScale(390, 844, 3)).toBe(1.5);
  });
  it('caps framebuffer cost on large Retina viewports', () => {
    const scale = atlasResolutionScale(1440, 900, 2);
    expect(scale).toBeGreaterThan(1);
    expect(1440 * 900 * scale * scale).toBeLessThanOrEqual(2_500_001);
    expect(atlasResolutionScale(3840, 2160, 2)).toBe(1);
  });
  it('does not undersample ordinary displays or divide by zero during mount', () => {
    expect(atlasResolutionScale(1440, 900, 1)).toBe(1);
    expect(Number.isFinite(atlasResolutionScale(0, 0, 2))).toBe(true);
  });
});

it('centers the globe at orbital distance without tilting nearby routes', () => {
  expect(atlasOrbitalPitchLimit(50_000)).toBe(-1.02);
  expect(atlasOrbitalPitchLimit(3_000_000)).toBeLessThan(-1.02);
  expect(atlasOrbitalPitchLimit(5_000_000)).toBeCloseTo(-Math.PI / 2);
  expect(atlasOrbitalPitchLimit(26_000_000)).toBeCloseTo(-Math.PI / 2);
});
