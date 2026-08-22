import { describe, expect, it } from "vitest";

import { studioExperienceLanguage } from "@/surfaces/admin/studio-language";

describe("Route Studio experience language", () => {
  it("uses Preview and cinematic timing for an uncompleted route", () => {
    expect(studioExperienceLanguage("discovered", "recorded")).toEqual({
      noun: "Preview",
      action: "Explore",
      film: "Route film",
      timing: "Cinematic timing",
    });
  });

  it("uses Replay and recorded timing only for a confirmed completion", () => {
    expect(studioExperienceLanguage("completed", "recorded")).toEqual({
      noun: "Replay",
      action: "Replay",
      film: "Route film",
      timing: "Owner-recorded timing",
    });
  });

  it("does not invent recorded timing for a completed geometry-only route", () => {
    expect(studioExperienceLanguage("completed", "unavailable").timing).toBe(
      "Cinematic timing",
    );
  });
});
