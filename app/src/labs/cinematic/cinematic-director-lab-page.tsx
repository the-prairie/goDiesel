import { useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import { CinematicDirectorStage } from "@/surfaces/replay/cinematic/cinematic-director-stage";
import { RouteNotFound } from "@/ui/route-not-found";
import { findRouteBySlug } from "@/data/routes";
import { useRouteDetail } from "@/data/use-route-detail";
import { useRouteAdventureLookup } from "@/data/use-route-adventure";
import { decodedRouteSlug } from "@/app/route-paths";
import type { CinematicCut } from "@/surfaces/replay/cinematic/route-cinematic-director";

const CINEMATIC_CUTS = new Set<CinematicCut>([
  "feature",
  "monumental",
  "kinetic",
  "intimate",
]);

export function CinematicDirectorLabPage() {
  const { routeSlug } = useParams();
  const [searchParams] = useSearchParams();
  const decodedSlug = decodedRouteSlug(routeSlug);
  const summary = decodedSlug ? findRouteBySlug(decodedSlug) : undefined;
  const detail = useRouteDetail(summary?.slug);
  // Chapters of a local adventure steer the director's hero shots. Without one
  // the plan is built from terrain signals alone, exactly as before.
  const lookup = useRouteAdventureLookup(detail.status === "ready" ? detail.route : undefined);
  const adventure = lookup.adventure;
  const anchors = useMemo(
    () => adventure?.chapters.map((chapter) => ({ id: chapter.id, title: chapter.title, atDistanceM: chapter.atDistanceM })) ?? [],
    [adventure],
  );
  const requestedCut = searchParams.get("cut");
  const initialCut =
    requestedCut && CINEMATIC_CUTS.has(requestedCut as CinematicCut)
      ? (requestedCut as CinematicCut)
      : "feature";

  if (!summary) return <RouteNotFound />;
  if (detail.status === "idle" || detail.status === "loading" || (detail.status === "ready" && !lookup.settled)) {
    return (
      <div
        aria-live="polite"
        className="grid min-h-[50dvh] place-items-center"
        role="status"
      >
        Preparing the director cut.
      </div>
    );
  }
  if (detail.status !== "ready") return <RouteNotFound />;

  return (
    <CinematicDirectorStage
      initialCut={initialCut}
      renderMode={searchParams.get("render") === "1"}
      route={detail.route}
      anchors={anchors}
      showPlan={searchParams.get("plan") === "1"}
    />
  );
}
