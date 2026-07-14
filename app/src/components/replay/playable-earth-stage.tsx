import { ArrowLeft, FlaskConical, Route } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import type { QuestRoute } from "@/domain/routes";
import { routeDetailPath } from "@/navigation";
import {
  createPlayableEarthViewer,
  type PlayableEarthStatus,
} from "@/replay/playable-earth-viewer";

const INITIAL_STATUS: PlayableEarthStatus = {
  state: "loading",
  title: "Building your route world",
  message: "Preparing the experimental Earth viewer.",
};

export function PlayableEarthStage({ route }: { route: QuestRoute }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<PlayableEarthStatus>(INITIAL_STATUS);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const viewer = createPlayableEarthViewer();
    setStatus(INITIAL_STATUS);
    void viewer.mount({ container, route, onStatus: setStatus });
    return () => viewer.destroy();
  }, [route]);

  return (
    <section
      aria-label="Playable Earth Lab"
      data-state={status.state}
      data-route-slug={route.slug}
      className="relative min-h-[calc(100dvh-3.5rem)] overflow-hidden bg-[#02070a]"
    >
      <div
        ref={containerRef}
        aria-label="Playable Earth world"
        className="absolute inset-0"
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-4 p-4 sm:p-6">
        <div className="pointer-events-auto max-w-md rounded-md border border-border bg-background/90 p-4 shadow-2xl backdrop-blur">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase text-primary">
            <FlaskConical className="size-4" aria-hidden="true" />
            Playable Earth Lab
          </div>
          <h1 className="mt-2 text-xl font-semibold sm:text-2xl">{route.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {route.distanceKm.toFixed(1)} km · {route.elevationGainM.toLocaleString()} m up
          </p>
        </div>
        <Button asChild variant="secondary" className="pointer-events-auto shrink-0">
          <Link to={routeDetailPath(route.slug)}>
            <ArrowLeft aria-hidden="true" />
            Exit lab
          </Link>
        </Button>
      </div>

      {status.state !== "ready" ? (
        <div className="absolute inset-0 z-10 grid place-items-center bg-background/72 p-6">
          <div
            role={status.state === "unavailable" ? "alert" : "status"}
            aria-live="polite"
            className="max-w-md rounded-md border border-border bg-card p-6 text-center shadow-2xl"
          >
            <div className="text-sm font-semibold">{status.title}</div>
            <p className="mt-2 text-sm text-muted-foreground">{status.message}</p>
            {status.state === "unavailable" ? (
              <Button asChild className="mt-5">
                <Link to={routeDetailPath(route.slug)}>Return to route</Link>
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="pointer-events-none absolute inset-x-4 bottom-4 z-20 flex justify-center sm:inset-x-6 sm:bottom-6">
        <div className="flex w-full max-w-xl items-center gap-3 rounded-md border border-border bg-background/90 px-4 py-3 shadow-2xl backdrop-blur">
          <Route className="size-4 shrink-0 text-primary" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold uppercase text-primary">
              {status.state === "ready" ? "Route thread ready" : "Route world loading"}
            </div>
            <div className="truncate text-sm text-muted-foreground">
              Start · 0.0 / {route.distanceKm.toFixed(1)} km
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
