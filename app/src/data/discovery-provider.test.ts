import { describe, expect, it } from "vitest";

import { buildCuratedDiscoveryCandidates } from "@/data/discovery-provider";

const missingDefinition = [
  { slug: "missing", terrain: ["trail" as const], vibes: ["quiet"] },
];

describe("curated discovery candidates", () => {
  it("keeps full application manifests fail-fast", () => {
    expect(() =>
      buildCuratedDiscoveryCandidates(
        missingDefinition,
        () => undefined,
        false,
      ),
    ).toThrow("Curated discovery route missing is missing");
  });

  it("allows route-scoped manifests to omit unrelated candidates", () => {
    expect(
      buildCuratedDiscoveryCandidates(missingDefinition, () => undefined, true),
    ).toEqual([]);
  });
});
