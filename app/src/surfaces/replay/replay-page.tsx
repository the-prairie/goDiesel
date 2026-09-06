import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import { EarthReplayStage } from "@/surfaces/replay/components/earth-replay-stage";
import { GoogleRouteNavigatorStage } from "@/surfaces/replay/components/google-route-navigator-stage";
import { JOURNAL_REPLAY_THREAD_STYLE } from "@/domain/geometry/route-thread-style";
import { RouteNotFound } from "@/ui/route-not-found";
import { singleRouteMicrosite } from "@/app/single-route-microsite";
import { completedRoutes, findRouteBySlug } from "@/data/routes";
import { useRouteDetail } from "@/data/use-route-detail";
import {
  APP_PATHS,
  decodedRouteSlug,
  replayReturnPath,
  routeDetailPath,
} from "@/app/route-paths";

const representativeRoute =
  completedRoutes.find(
    (route) => route.replay.bestInEarth && route.replay.replayEligible,
  ) ?? completedRoutes.find((route) => route.replay.replayEligible);

export function ReplayPage() {
  const { routeSlug } = useParams();
  const [searchParams] = useSearchParams();
  const decodedSlug = decodedRouteSlug(routeSlug);
  const selectedSummary = routeSlug
    ? decodedSlug
      ? findRouteBySlug(decodedSlug)
      : undefined
    : representativeRoute;
  const detail = useRouteDetail(selectedSummary?.slug);
  const requestedRenderer = searchParams.get("renderer");
  const requestedAtlas = requestedRenderer === "atlas";
  const useLegacyEarth = requestedRenderer === "cesium";
  const [atlasFallback, setAtlasFallback] = useState(requestedAtlas);

  useEffect(() => {
    setAtlasFallback(requestedAtlas);
  }, [requestedAtlas, selectedSummary?.slug]);

  if (routeSlug && !selectedSummary) return <RouteNotFound />;

  const eligibleRoutes = completedRoutes.filter(
    (route) => route.replay.replayEligible,
  );
  const pickerRoutes = singleRouteMicrosite
    ? []
    : selectedSummary
    ? [
        selectedSummary,
        ...eligibleRoutes.filter((route) => route.slug !== selectedSummary.slug),
      ]
    : eligibleRoutes;

  if (detail.status === "idle" || detail.status === "loading") {
    return (
      <div role="status" aria-live="polite" className="grid min-h-[50dvh] place-items-center">
        Loading Earth Replay.
      </div>
    );
  }
  if (detail.status !== "ready") return <RouteNotFound />;

  const returnPath = replayReturnPath(searchParams, detail.route.slug);
  const backPath =
    singleRouteMicrosite?.guidePath ??
    returnPath ??
    routeDetailPath(detail.route.slug);
  const backLabel = singleRouteMicrosite
    ? "Route guide"
    : returnPath?.startsWith(APP_PATHS.atlas)
      ? "Back to Atlas"
      : "Route story";
  /*
   * Optional presentation cast, opt-in via ?theme=journal. Replay stays dark;
   * this only re-tints the chrome tokens it already uses so the surface carries
   * the same identity as the route story it was entered from. Absent the
   * parameter nothing changes.
   */
  const journalPresentation = searchParams.get("theme") === "journal";
  const presentation = journalPresentation ? "seed-replay-warm" : undefined;
  // The route keeps its identity across Atlas, story and Replay. Only the
  // journal presentation opts in; every other caller keeps the shared default.
  const threadStyle = journalPresentation ? JOURNAL_REPLAY_THREAD_STYLE : undefined;
  /*
   * Entry distance, in metres along the recorded route.
   *
   * A caller that entered from a held position on the route passes it so
   * playback begins where the reader was standing. Absent or out of range,
   * playback opens at the start exactly as before.
   */
  const requestedAt = Number(searchParams.get("at"));
  const initialProgressM =
    Number.isFinite(requestedAt) && requestedAt > 0 ? requestedAt : undefined;

  if (!useLegacyEarth && !atlasFallback) {
    return (
      <div className={presentation}>
        <GoogleRouteNavigatorStage
          route={detail.route}
          variant="replay"
          pickerRoutes={pickerRoutes}
          backPath={backPath}
          backLabel={backLabel}
          onUseAtlas={() => setAtlasFallback(true)}
        />
      </div>
    );
  }

  return (
    <div className={presentation}>
      <EarthReplayStage
        route={detail.route}
        pickerRoutes={pickerRoutes}
        backPath={backPath}
        backLabel={backLabel}
        initialEngineMode={atlasFallback ? "atlas" : "earth"}
        initialProgressM={initialProgressM}
        allowEarthMode={useLegacyEarth}
        threadStyle={threadStyle}
      />
    </div>
  );
}
