import { filmDuration, type Adventure, type RouteAdventure } from "@/domain/adventure";
import type { QuestRoute } from "@/domain/route";

export type ReadinessState = "pass" | "attention" | "blocked" | "unchecked" | "decision";

export interface ReadinessCheck {
  id: "placement" | "recordings" | "media" | "scenes" | "film" | "audience";
  label: string;
  state: ReadinessState;
  detail: string;
}

export interface MediaCheck {
  id: string;
  matches: boolean;
  bytes: number;
}

/**
 * What stands between an imported adventure and a publication. It prepares a
 * decision; it never makes one. The audience is always the owner's.
 */
export function adventureReadiness(
  adventure: Adventure,
  placements: RouteAdventure[],
  routes: Record<string, Pick<QuestRoute, "lifecycle"> | undefined>,
  media?: MediaCheck[],
): ReadinessCheck[] {
  const withheld = placements.flatMap((placed) => placed.withheld);
  const unloaded = adventure.legs.filter((leg) => !placements.some((placed) => placed.leg.slug === leg.slug));
  const notOwn = adventure.legs.filter((leg) => routes[leg.slug] && routes[leg.slug]!.lifecycle !== "completed");
  const mismatched = media?.filter((item) => !item.matches) ?? [];
  const bytes = media?.reduce((sum, item) => sum + item.bytes, 0) ?? 0;
  const film = adventure.film;

  return [
    {
      id: "placement",
      label: "Every chapter and scene lands on its recording",
      state: withheld.length || unloaded.length ? "blocked" : "pass",
      detail: unloaded.length
        ? `${unloaded.length} recording${unloaded.length === 1 ? "" : "s"} could not be loaded to confirm placement.`
        : withheld.length
          ? `${withheld.length} anchor${withheld.length === 1 ? "" : "s"} withheld: ${withheld.map((item) => `${item.title} (${item.reason})`).join("; ")}`
          : `${adventure.chapters.length + adventure.scenes.length} anchors confirmed against the canonical geometry.`,
    },
    {
      id: "recordings",
      label: "The recordings are the owner's own",
      state: notOwn.length ? "attention" : "pass",
      detail: notOwn.length
        ? `${notOwn.map((leg) => leg.label).join(", ")} ${notOwn.length === 1 ? "is" : "are"} not a completed recording; say so wherever it is shown.`
        : `${adventure.legs.length} completed recording${adventure.legs.length === 1 ? "" : "s"}.`,
    },
    {
      id: "media",
      label: "Footage matches its imported digests",
      state: !media ? "unchecked" : mismatched.length || media.length !== adventure.footage.length ? "blocked" : "pass",
      detail: !media
        ? `${adventure.footage.length} clip${adventure.footage.length === 1 ? "" : "s"} not yet checked.`
        : mismatched.length
          ? `${mismatched.map((item) => item.id).join(", ")} changed since import.`
          : `${media.length} clips, ${(bytes / 1_000_000).toFixed(1)} MB, digests match.`,
    },
    {
      id: "scenes",
      label: "Captured scenes are credited and hosted by their authors",
      state: adventure.scenes.length ? "attention" : "pass",
      detail: adventure.scenes.length
        ? `${adventure.scenes.map((scene) => `${scene.title} by ${scene.attribution.author}`).join("; ")}. Served by Sketchfab, so availability is theirs.`
        : "No captured scenes.",
    },
    {
      id: "film",
      label: "The film is a chapter, not a feature",
      state: "pass",
      detail: film ? `${film.beats.length} beats, ${Math.round(filmDuration(film))} s.` : "No film.",
    },
    {
      id: "audience",
      label: "Audience",
      state: "decision",
      detail:
        "Not decided here. goDiesel builds contain no adventures until a scoped publisher exists; this adventure's own Site keeps its current audience.",
    },
  ];
}
