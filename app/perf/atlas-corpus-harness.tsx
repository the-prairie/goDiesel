import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

import "@/index.css";
import { buildRouteRegions } from "@/data/route-regions";
import { completedRoutes, routes } from "@/data/routes";
import type { RouteSummary } from "@/domain/route";
import { CesiumAtlasGlobe } from "@/surfaces/atlas/components/cesium-atlas-globe";
import type { AtlasWorldStatus } from "@/surfaces/atlas/atlas-world";
import {
  countUniqueRouteTraces,
  createDistinctRouteCorpus,
} from "./runtime-corpus";

const CORPUS_SIZE = 2_500;

function AtlasCorpusHarness() {
  const productionDistribution =
    new URLSearchParams(window.location.search).get("distribution") ===
    "production";
  const corpus = useMemo(
    () =>
      productionDistribution
        ? {
            routes: completedRoutes,
            uniqueTraceCount: countUniqueRouteTraces(completedRoutes),
          }
        : createDistinctRouteCorpus(routes, CORPUS_SIZE),
    [productionDistribution],
  );
  const regions = useMemo(() => buildRouteRegions(corpus.routes), [corpus.routes]);
  const [status, setStatus] = useState<AtlasWorldStatus>({
    state: "loading",
    message: "Opening the performance Atlas.",
  });
  const [selectedRoute, setSelectedRoute] = useState<RouteSummary>();

  return (
    <main
      data-runtime-atlas-corpus={corpus.routes.length}
      data-runtime-atlas-distribution={
        productionDistribution ? "production" : "scale"
      }
      data-runtime-atlas-unique-geometry={corpus.uniqueTraceCount}
      data-runtime-atlas-status={status.state}
      className="h-dvh w-dvw overflow-hidden bg-[#02070a]"
    >
      <CesiumAtlasGlobe
        regions={regions}
        selectedRoute={selectedRoute}
        onSelectRegion={() => undefined}
        onSelectRoute={setSelectedRoute}
        onStatusChange={setStatus}
        className="h-full min-h-0 w-full"
      />
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Runtime Atlas corpus root is missing");
createRoot(root).render(
  <StrictMode>
    <AtlasCorpusHarness />
  </StrictMode>,
);
