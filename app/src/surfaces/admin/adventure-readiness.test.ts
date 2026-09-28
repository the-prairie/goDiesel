import { describe, expect, it } from "vitest";

import { syntheticAdventureJson, syntheticRoute } from "@/domain/adventure/adventure-fixtures";
import { parseAdventure } from "@/domain/adventure/parse";
import { placeAdventureOnRoute } from "@/domain/adventure/placement";
import { adventureReadiness } from "@/surfaces/admin/adventure-readiness";

const adventure = parseAdventure(syntheticAdventureJson());
const routes = {
  "leg-one": { ...syntheticRoute("leg-one", 4_000), lifecycle: "completed" },
  "leg-two": { ...syntheticRoute("leg-two", 4_000), lifecycle: "completed" },
} as const;
const placements = () =>
  Object.values(routes).map((route) => placeAdventureOnRoute(adventure, route as never)!);

const state = (checks: ReturnType<typeof adventureReadiness>, id: string) => checks.find((check) => check.id === id)?.state;

describe("adventureReadiness", () => {
  it("passes placement when every anchor lands on its recording", () => {
    expect(state(adventureReadiness(adventure, placements(), routes as never), "placement")).toBe("pass");
  });

  it("blocks placement when an anchor is withheld", () => {
    const shifted = { ...routes, "leg-two": { ...syntheticRoute("leg-two", 4_000, [], 0.009), lifecycle: "completed" } };
    const placed = Object.values(shifted).map((route) => placeAdventureOnRoute(adventure, route as never)!);
    const check = adventureReadiness(adventure, placed, shifted as never).find((item) => item.id === "placement")!;
    expect(check.state).toBe("blocked");
    expect(check.detail).toMatch(/3 anchors/);
  });

  it("asks for attention when a leg is not the owner's own recording", () => {
    const discovered = { ...routes, "leg-one": { ...routes["leg-one"], lifecycle: "discovered" } };
    expect(state(adventureReadiness(adventure, placements(), discovered as never), "recordings")).toBe("attention");
  });

  it("reports media digests only once they have been checked", () => {
    expect(state(adventureReadiness(adventure, placements(), routes as never), "media")).toBe("unchecked");
    const verified = adventure.footage.map((clip) => ({ id: clip.id, matches: true, bytes: 10 }));
    expect(state(adventureReadiness(adventure, placements(), routes as never, verified), "media")).toBe("pass");
    const broken = [{ ...verified[0], matches: false }, ...verified.slice(1)];
    expect(state(adventureReadiness(adventure, placements(), routes as never, broken), "media")).toBe("blocked");
  });

  it("always leaves the audience as the owner's decision", () => {
    const audience = adventureReadiness(adventure, placements(), routes as never).find((check) => check.id === "audience")!;
    expect(audience.state).toBe("decision");
  });
});
