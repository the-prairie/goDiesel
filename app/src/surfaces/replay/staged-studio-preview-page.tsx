import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import { loadStudioJob, type StudioJob } from "@/data/studio-repository";
import { CinematicDirectorStage } from "@/surfaces/replay/cinematic/cinematic-director-stage";
import { CinematicRouteTrailerStage } from "@/surfaces/replay/cinematic/cinematic-route-trailer-stage";
import type { CinematicCut } from "@/surfaces/replay/cinematic/route-cinematic-director";
import { EarthReplayStage } from "@/surfaces/replay/components/earth-replay-stage";
import { GoogleRouteNavigatorStage } from "@/surfaces/replay/components/google-route-navigator-stage";

const cuts = new Set<CinematicCut>(["feature", "monumental", "kinetic", "intimate"]);

export function StagedStudioPreviewPage() {
  const { jobId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const [job, setJob] = useState<StudioJob | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [atlasFallback, setAtlasFallback] = useState(false);

  useEffect(() => {
    let active = true;
    void loadStudioJob(jobId).then((loaded) => active && setJob(loaded)).catch((error) => active && setMessage(error instanceof Error ? error.message : "Staged route could not be loaded."));
    return () => { active = false; };
  }, [jobId]);

  const route = job?.stagedRoute;
  if (!route) return <div className="grid min-h-[50dvh] place-items-center" role={message ? "alert" : "status"}>{message ?? "Loading staged route..."}</div>;
  const completed = route.lifecycle === "completed";
  const backPath = `/admin/studio/${encodeURIComponent(jobId)}`;
  const requestedCut = searchParams.get("cut") as CinematicCut | null;
  if (searchParams.get("render") === "1") {
    return <CinematicRouteTrailerStage backLabel="Back to Route Studio" backPath={backPath} decisionLabel={`Open interactive ${completed ? "Replay" : "Preview"}`} decisionPath={`/admin/studio/${encodeURIComponent(jobId)}/preview`} renderMode route={route} />;
  }
  if (searchParams.get("film") === "1") {
    if (!completed || route.provenance.elevation?.status === "unavailable") {
      return <CinematicRouteTrailerStage backLabel="Back to Route Studio" backPath={backPath} decisionLabel={`Open interactive ${completed ? "Replay" : "Preview"}`} decisionPath={`/admin/studio/${encodeURIComponent(jobId)}/preview`} route={route} />;
    }
    return <CinematicDirectorStage backLabel="Back to Route Studio" backPath={backPath} decisionLabel={`Open interactive ${completed ? "Replay" : "Preview"}`} decisionPath={`/admin/studio/${encodeURIComponent(jobId)}/preview`} experienceMode={completed ? "replay" : "preview"} initialCut={requestedCut && cuts.has(requestedCut) ? requestedCut : "feature"} route={route} />;
  }
  if (!atlasFallback) {
    return <GoogleRouteNavigatorStage backLabel="Back to Route Studio" backPath={backPath} onUseAtlas={() => setAtlasFallback(true)} pickerRoutes={[]} route={route} variant={completed ? "replay" : "preview"} />;
  }
  return <EarthReplayStage allowEarthMode={false} backLabel="Back to Route Studio" backPath={backPath} experienceMode={completed ? "replay" : "preview"} initialEngineMode="atlas" pickerRoutes={[]} route={route} />;
}
