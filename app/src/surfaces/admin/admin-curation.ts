import type { CurationReviewStatus, RouteGeometryStatus } from "@/domain/routes";

export interface CurationDraft {
  vibe: string;
  idealUse: string;
  terrain: string[];
  difficulty: string;
  highlights: string[];
  caveats: string[];
  seasonality: string;
  editorialNote: string;
  reviewStatus: CurationReviewStatus;
}

export interface AdminRouteRecord {
  activityId: string;
  name: string;
  region: string;
  date: string;
  type: string;
  distanceKm: number;
  sourceStatus: string;
  curation: CurationDraft;
  geometryStatus: RouteGeometryStatus;
  replayEligible: boolean;
  generationStatus: "ready" | "missing" | "building" | "failed";
}

export interface CurationValidation {
  state: "draft-incomplete" | "draft-complete" | "reviewed" | "invalid";
  missingFields: string[];
  canSave: boolean;
  message: string;
}

export const emptyCurationDraft: CurationDraft = {
  vibe: "",
  idealUse: "",
  terrain: [],
  difficulty: "",
  highlights: [],
  caveats: [],
  seasonality: "",
  editorialNote: "",
  reviewStatus: "draft",
};

const requiredFields: (keyof Omit<CurationDraft, "reviewStatus">)[] = [
  "vibe",
  "idealUse",
  "terrain",
  "difficulty",
  "highlights",
  "caveats",
  "seasonality",
  "editorialNote",
];

export function validateCuration(draft: CurationDraft): CurationValidation {
  const missingFields = requiredFields.filter((field) => {
    const value = draft[field];
    return Array.isArray(value) ? value.length === 0 : !value.trim();
  });

  if (draft.reviewStatus === "draft") {
    return missingFields.length > 0
      ? {
          state: "draft-incomplete",
          missingFields,
          canSave: true,
          message: `${missingFields.length} guide ${missingFields.length === 1 ? "field is" : "fields are"} still missing. This can remain a draft.`,
        }
      : {
          state: "draft-complete",
          missingFields: [],
          canSave: true,
          message: "All guide fields are complete. The route can be marked reviewed.",
        };
  }

  if (missingFields.length > 0) {
    return {
      state: "invalid",
      missingFields,
      canSave: false,
      message: `${capitalize(draft.reviewStatus)} guides require every curation field.`,
    };
  }

  return {
    state: "reviewed",
    missingFields: [],
    canSave: true,
    message: `${capitalize(draft.reviewStatus)} guide is complete and ready to generate.`,
  };
}

export function toCurationPayload(draft: CurationDraft) {
  return {
    vibe: draft.vibe.trim(),
    ideal_use: draft.idealUse.trim(),
    terrain: draft.terrain,
    difficulty: draft.difficulty.trim(),
    highlights: draft.highlights,
    caveats: draft.caveats,
    seasonality: draft.seasonality.trim(),
    editorial_note: draft.editorialNote.trim(),
    review_status: draft.reviewStatus,
  };
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
