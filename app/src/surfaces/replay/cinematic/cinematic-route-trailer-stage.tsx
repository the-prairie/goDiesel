import {
  ArrowLeft,
  ChevronRight,
  Pause,
  Play,
  RotateCcw,
  ScanLine,
  SkipForward,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { Button } from "@/ui/button";
import type { QuestRoute } from "@/domain/routes";
import {
  ROUTE_TRAILER_DURATION_SECONDS,
  routeTrailerFrame,
  type RouteTrailerFrame,
} from "@/surfaces/replay/cinematic/route-trailer-controller";
import {
  createGoogleRouteNavigatorEngine,
  type GoogleRouteNavigatorEngine,
  type GoogleRouteNavigatorStatus,
} from "@/surfaces/replay/renderers/google-route-navigator-engine";

const INITIAL_STATUS: GoogleRouteNavigatorStatus = {
  state: "loading",
  message: "Preparing the route world.",
};

function routePictureLine(route: QuestRoute) {
  const place = `${route.name} ${route.region}`.toLowerCase();
  if (
    route.slug === "14736711660" ||
    place.includes("san francisco") ||
    place.includes("bay area")
  ) {
    return "A city measured in water, wind, and vertical streets.";
  }
  if (place.includes("crete")) {
    return "A raw edge of sea, stone, and exposure.";
  }
  return `A ${route.distanceKm.toFixed(1)} kilometre line through ${route.region}.`;
}

export function CinematicRouteTrailerStage({ route }: { route: QuestRoute }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<GoogleRouteNavigatorEngine | undefined>(undefined);
  const elapsedRef = useRef(0);
  const playingRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [status, setStatus] = useState<GoogleRouteNavigatorStatus>(INITIAL_STATUS);
  const [frame, setFrame] = useState<RouteTrailerFrame>(() =>
    routeTrailerFrame(route, 0),
  );

  const commitFrame = (elapsedSeconds: number) => {
    const next = routeTrailerFrame(route, elapsedSeconds);
    elapsedRef.current = elapsedSeconds;
    engineRef.current?.setCamera(next.camera);
    engineRef.current?.setRouteReveal(next.reveal);
    setFrame(next);
  };

  const setPlayback = (next: boolean) => {
    playingRef.current = next;
    setPlaying(next);
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const engine = createGoogleRouteNavigatorEngine();
    engineRef.current = engine;
    elapsedRef.current = 0;
    setFrame(routeTrailerFrame(route, 0));
    setStatus(INITIAL_STATUS);

    void engine.mount({
      apiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "",
      container,
      route,
      groundingMode: "mesh",
      onStatus: (next) => {
        setStatus(next);
        if (next.state !== "ready") return;
        const reducedMotion = window.matchMedia(
          "(prefers-reduced-motion: reduce)",
        ).matches;
        const initialElapsed = reducedMotion
          ? ROUTE_TRAILER_DURATION_SECONDS
          : 0;
        const initialFrame = routeTrailerFrame(route, initialElapsed);
        elapsedRef.current = initialElapsed;
        engine.setCamera(initialFrame.camera);
        engine.setRouteReveal(initialFrame.reveal);
        setFrame(initialFrame);
        setPlayback(!reducedMotion);
      },
    });

    return () => {
      setPlayback(false);
      engine.destroy();
      if (engineRef.current === engine) engineRef.current = undefined;
    };
  }, [route]);

  useEffect(() => {
    if (status.state !== "ready") return;
    let animationFrame = 0;
    let previous = performance.now();
    let lastUiUpdate = previous;
    const tick = (now: number) => {
      const deltaSeconds = Math.min(0.1, (now - previous) / 1_000);
      previous = now;
      if (playingRef.current) {
        const elapsed = Math.min(
          ROUTE_TRAILER_DURATION_SECONDS,
          elapsedRef.current + deltaSeconds,
        );
        const next = routeTrailerFrame(route, elapsed);
        elapsedRef.current = elapsed;
        engineRef.current?.setCamera(next.camera);
        engineRef.current?.setRouteReveal(next.reveal);
        if (now - lastUiUpdate >= 80 || elapsed >= ROUTE_TRAILER_DURATION_SECONDS) {
          setFrame(next);
          lastUiUpdate = now;
        }
        if (elapsed >= ROUTE_TRAILER_DURATION_SECONDS) setPlayback(false);
      }
      animationFrame = requestAnimationFrame(tick);
    };
    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [route, status.state]);

  const restart = () => {
    commitFrame(0);
    setPlayback(true);
  };

  const skip = () => {
    commitFrame(ROUTE_TRAILER_DURATION_SECONDS);
    setPlayback(false);
  };

  return (
    <section
      aria-label={`Cinematic preview of ${route.name}`}
      className="fixed inset-0 z-[100] overflow-hidden bg-black text-white"
      data-chapter={frame.chapter}
      data-state={status.state}
      data-testid="route-trailer"
    >
      <div
        aria-label={`Google photorealistic 3D trailer of ${route.name}`}
        className="absolute inset-0"
        ref={containerRef}
      />

      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.72)_0%,transparent_22%,transparent_68%,rgba(0,0,0,0.88)_100%)]"
      />
      <div aria-hidden="true" className="absolute inset-x-0 top-0 h-3 bg-black" />
      <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-3 bg-black" />

      <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-4 px-5 pt-7 sm:px-8 sm:pt-9">
        <Link
          aria-label="Back to route intelligence"
          className="inline-flex size-10 items-center justify-center border border-white/30 bg-black/35 text-white backdrop-blur-md transition-colors hover:bg-black/60"
          to="/lab/route-intelligence"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
        </Link>
        <div className="text-right">
          <div className="text-[0.66rem] font-semibold uppercase tracking-[0.2em] text-white/62">
            goDiesel route picture
          </div>
          <div className="mt-1 text-sm text-white/88">{route.region}</div>
        </div>
      </div>

      {!frame.showDecision && status.state === "ready" ? (
        <div
          aria-live="polite"
          className="pointer-events-none absolute inset-x-5 bottom-24 z-20 sm:inset-x-8 sm:bottom-28"
          data-testid="route-trailer-chapter"
        >
          <div className="h-px w-12 bg-[#f16c4b]" />
          <p className="mt-3 text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-white/68">
            {frame.chapterLabel}
          </p>
          <h1 className="mt-1 max-w-4xl font-editorial text-3xl font-semibold leading-[0.98] sm:text-4xl">
            {frame.chapter === "the-place"
              ? route.name
              : frame.chapter === "the-line"
                ? `${route.distanceKm.toFixed(1)} kilometres, drawn through the world.`
                : frame.chapter === "the-terrain"
                  ? routePictureLine(route)
                  : "Would you take this line?"}
          </h1>
        </div>
      ) : null}

      {frame.showDecision ? (
        <div
          className="absolute inset-x-0 bottom-12 z-20 border-y border-white/22 bg-black/72 px-5 py-5 backdrop-blur-md sm:bottom-14 sm:px-8 sm:py-7"
          data-testid="route-trailer-decision"
        >
          <div className="mx-auto grid max-w-7xl gap-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <div>
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-[#ff896d]">
                The route is real
              </p>
              <h1 className="mt-2 font-editorial text-4xl font-semibold leading-none sm:text-6xl">
                {route.name}
              </h1>
              <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/72">
                <span>{route.distanceKm.toFixed(1)} km</span>
                <span>{route.elevationGainM.toLocaleString()} m up</span>
                <span>{route.type}</span>
                <span>{route.date}</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                className="border-white/35 bg-transparent text-white hover:bg-white/12"
                onClick={restart}
                variant="outline"
              >
                <RotateCcw aria-hidden="true" />
                Watch again
              </Button>
              <Button
                asChild
                className="bg-[#f16c4b] text-white hover:bg-[#d95639]"
              >
                <Link to={`/lab/google-route-navigator/${route.slug}`}>
                  Enter the route
                  <ChevronRight aria-hidden="true" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {status.state !== "ready" ? (
        <div className="absolute inset-0 z-30 grid place-items-center bg-black/88 p-6">
          <div
            aria-live="polite"
            className="max-w-md text-center"
            role={status.state === "unavailable" ? "alert" : "status"}
          >
            <ScanLine
              aria-hidden="true"
              className="mx-auto size-5 text-[#f16c4b]"
            />
            <h2 className="mt-4 font-editorial text-3xl font-semibold">
              {status.state === "loading"
                ? "Building the route picture"
                : "Route picture unavailable"}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-white/62">
              {status.message}
            </p>
          </div>
        </div>
      ) : null}

      <div className="absolute inset-x-5 bottom-5 z-30 flex items-center gap-3 sm:inset-x-8">
        <button
          aria-label={playing ? "Pause trailer" : "Play trailer"}
          className="grid size-9 shrink-0 place-items-center border border-white/30 bg-black/42 text-white backdrop-blur-md hover:bg-black/70 disabled:opacity-45"
          disabled={status.state !== "ready"}
          onClick={() => setPlayback(!playingRef.current)}
          type="button"
        >
          {playing ? (
            <Pause aria-hidden="true" className="size-3.5" />
          ) : (
            <Play aria-hidden="true" className="size-3.5" />
          )}
        </button>
        <div className="h-px min-w-0 flex-1 bg-white/30">
          <div
            className="h-px bg-[#f16c4b]"
            data-testid="route-trailer-progress"
            style={{ width: `${frame.progress * 100}%` }}
          />
        </div>
        {!frame.showDecision ? (
          <button
            className="inline-flex h-9 items-center gap-2 px-2 text-xs font-medium text-white/70 hover:text-white"
            disabled={status.state !== "ready"}
            onClick={skip}
            type="button"
          >
            <SkipForward aria-hidden="true" className="size-3.5" />
            Skip
          </button>
        ) : null}
      </div>
    </section>
  );
}
