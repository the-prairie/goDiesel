import { describe, expect, it } from "vitest";

import { groundedComparison, NOT_JUDGED_FROM_A_RECORDING } from "@/domain/planning-evidence";
import type { DiscoveryCandidate, FinderIntent } from "@/domain/planning";

const intent: FinderIntent = { place: "Crete", activity: "Run", distanceKm: 10, terrain: "trail", vibe: "coastal" };
const candidate = (route: Partial<DiscoveryCandidate["route"]>) =>
  ({
    terrain: ["trail", "mountain"],
    vibes: ["coastal", "playful"],
    route: { distanceKm: 12.1, elevationGainM: 868, elevationStatus: "recorded", ...route },
  }) as DiscoveryCandidate;

describe("groundedComparison", () => {
  it("compares measured distance against the plan", () => {
    const [distance] = groundedComparison(candidate({}), intent).measured;
    expect(distance).toMatchObject({ label: "Distance", value: "12.1 km", evidence: "recorded" });
    expect(distance.note).toBe("2.1 km longer than your 10 km");
  });

  it("derives a climb rate only from recorded climb and distance", () => {
    const measured = groundedComparison(candidate({}), intent).measured;
    expect(measured[1]).toMatchObject({ label: "Climb", value: "868 m", evidence: "recorded" });
    expect(measured[2]).toMatchObject({ label: "Climb rate", value: "72 m/km", evidence: "derived" });
  });

  it("says unavailable instead of inventing a climb", () => {
    const measured = groundedComparison(candidate({ elevationStatus: "unavailable", elevationGainM: null }), intent).measured;
    expect(measured[1].value).toBe("Unavailable");
    expect(measured[2].value).toBe("Unavailable");
  });

  it("keeps the owner's terrain and feeling words as tags, not measurements", () => {
    const result = groundedComparison(candidate({}), intent);
    expect(result.ownerTags).toEqual(["trail", "mountain", "coastal", "playful"]);
    expect(result.measured.map((item) => item.label)).not.toContain("Surface");
  });

  it("names what a recording cannot tell you", () => {
    expect(NOT_JUDGED_FROM_A_RECORDING).toEqual(expect.arrayContaining(["surface", "difficulty", "safety", "current access", "solitude"]));
  });

  it("explains a match without claiming a feeling", () => {
    const reason = groundedComparison(candidate({}), intent).matchReason;
    expect(reason).toMatch(/2\.1 km longer than your 10 km/);
    expect(reason).toMatch(/owner tagged it trail/);
    expect(reason).not.toMatch(/feeling/);
  });
});
