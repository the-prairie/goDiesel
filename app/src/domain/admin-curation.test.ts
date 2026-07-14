import { describe, expect, it } from "vitest";

import {
  emptyCurationDraft,
  toCurationPayload,
  validateCuration,
  type CurationDraft,
} from "@/domain/admin-curation";

const complete: CurationDraft = {
  vibe: "Quiet lanes opening into a climb.",
  idealUse: "A cool day with time to explore.",
  terrain: ["Paved lanes", "Hills"],
  difficulty: "Demanding",
  highlights: ["Temple district"],
  caveats: ["Road crossings"],
  seasonality: "Best in cool weather.",
  editorialNote: "Preserved for its city-to-hills contrast.",
  reviewStatus: "reviewed",
};

describe("validateCuration", () => {
  it("allows incomplete drafts while naming every missing field", () => {
    const result = validateCuration({ ...emptyCurationDraft, vibe: "Riverside miles." });

    expect(result.state).toBe("draft-incomplete");
    expect(result.canSave).toBe(true);
    expect(result.missingFields).toContain("idealUse");
    expect(result.missingFields).not.toContain("vibe");
  });

  it("rejects incomplete reviewed guides", () => {
    const result = validateCuration({
      ...emptyCurationDraft,
      vibe: "Riverside miles.",
      reviewStatus: "reviewed",
    });

    expect(result.state).toBe("invalid");
    expect(result.canSave).toBe(false);
  });

  it("serializes every established field to the backend contract", () => {
    expect(toCurationPayload(complete)).toEqual({
      vibe: complete.vibe,
      ideal_use: complete.idealUse,
      terrain: complete.terrain,
      difficulty: complete.difficulty,
      highlights: complete.highlights,
      caveats: complete.caveats,
      seasonality: complete.seasonality,
      editorial_note: complete.editorialNote,
      review_status: "reviewed",
    });
    expect(validateCuration(complete)).toMatchObject({ state: "reviewed", canSave: true });
  });
});
