import { afterEach, describe, expect, it, vi } from "vitest";

async function loadCandidates() {
  vi.resetModules();
  return (await import("@/data/discovery-provider")).curatedDiscoveryCandidates;
}

describe("curated discovery candidates", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("keeps the owner's terrain and vibes in the full application", async () => {
    vi.stubEnv("VITE_SINGLE_ROUTE_SLUG", "");
    const curated = (await loadCandidates()).filter((candidate) => candidate.vibes.length > 0);
    expect(curated.map((candidate) => candidate.sourceRouteSlug).sort()).toEqual(
      ["13358070690", "14130772463", "17654151284", "5650407638"],
    );
  });

  it("carries no route-named definitions in a single-route build", async () => {
    vi.stubEnv("VITE_SINGLE_ROUTE_SLUG", "14023448720");
    const candidates = await loadCandidates();
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((candidate) => candidate.terrain.length === 0 && candidate.vibes.length === 0)).toBe(true);
  });
});
