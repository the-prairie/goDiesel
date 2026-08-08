import { useParams, useSearchParams } from "react-router-dom";

import { CinematicDirectorStage } from "@/components/replay/cinematic-director-stage";
import { RouteNotFound } from "@/surfaces/routes/components/route-not-found";
import { findRouteBySlug } from "@/data/routes";
import { useRouteDetail } from "@/data/use-route-detail";
import { decodedRouteSlug } from "@/app/route-paths";
import type { CinematicCut } from "@/replay/cinematic/route-cinematic-director";

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
  const requestedCut = searchParams.get("cut");
  const initialCut =
    requestedCut && CINEMATIC_CUTS.has(requestedCut as CinematicCut)
      ? (requestedCut as CinematicCut)
      : "feature";

  if (!summary) return <RouteNotFound />;
  if (detail.status === "idle" || detail.status === "loading") {
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
    />
  );
}
