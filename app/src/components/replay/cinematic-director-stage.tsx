import {
  ArrowLeft,
  ChevronRight,
  Headphones,
  Pause,
  Play,
  RotateCcw,
  Route as RouteIcon,
  ScanLine,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { RecordedLightLayer } from "@/components/replay/recorded-light-layer";
import { recordedLightAt } from "@/domain/recorded-light";
import type { QuestRoute } from "@/domain/routes";
import { CinematicSoundscape } from "@/replay/cinematic/cinematic-soundscape";
import {
  type CinematicRendererStatus,
} from "@/replay/cinematic/cesium-cinematic-renderer";
import { NativeCinematicRenderer } from "@/replay/cinematic/native-cinematic-renderer";
import {
  CINEMATIC_CUT_LABELS,
  cinematicFrame,
  cinematicProfile,
  cinematicShotTimeline,
  type CinematicCut,
} from "@/replay/cinematic/route-cinematic-director";

const CUT_DESCRIPTIONS: Record<CinematicCut, string> = {
  feature: "A route-directed film shaped by the recorded terrain and line.",
  monumental: "Scale, silence, and the full weight of the landscape.",
  kinetic: "A faster line built from speed, turns, and release.",
  intimate: "Closer to the ground, with the effort left in the frame.",
};

const INITIAL_STATUS: CinematicRendererStatus = {
  state: "loading",
  message: "Scouting the route.",
};

function routeLogline(route: QuestRoute) {
  const profile = cinematicProfile(route);
  const curated =
    route.curation.reviewStatus === "reviewed" ||
    route.curation.reviewStatus === "published"
      ? route.curation.vibe || route.curation.editorialNote
      : undefined;
  if (curated) return curated;
  if (profile.character === "mountain") {
    return `${route.region} does not give this one away: ${route.distanceKm.toFixed(1)} kilometres, ${route.elevationGainM.toLocaleString()} metres of ascent, and a line that keeps climbing into the horizon.`;
  }
  if (profile.character === "rolling") {
    return `A restless line through ${route.region}, where ${route.distanceKm.toFixed(1)} kilometres of bends and rises never quite settle into a rhythm.`;
  }
  return `${route.distanceKm.toFixed(1)} open kilometres through ${route.region}. The invitation is simple: find the line, then let it run.`;
}

function routeInvitation(route: QuestRoute) {
  return route.type.toLowerCase().includes("ride")
    ? {
        eyebrow: "The road is still out there",
        title: "Would you ride it?",
        action: "Ride the route",
      }
    : {
        eyebrow: "The road is still out there",
        title: "Would you run it?",
        action: "Run the route",
      };
}

function recordedGrade(phase: ReturnType<typeof recordedLightAt>["phase"]) {
  return {
    neutral: { hue: 0, sepia: 0 },
    dawn: { hue: -4, sepia: 0.08 },
    midday: { hue: 0, sepia: 0.015 },
    dusk: { hue: -8, sepia: 0.12 },
    night: { hue: 8, sepia: 0.04 },
  }[phase];
}

export function CinematicDirectorStage({
  initialCut = "feature",
  renderMode = false,
  route,
}: {
  initialCut?: CinematicCut;
  renderMode?: boolean;
  route: QuestRoute;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<NativeCinematicRenderer | undefined>(undefined);
  const soundRef = useRef<CinematicSoundscape | undefined>(undefined);
  const elapsedRef = useRef(0);
  const playingRef = useRef(false);
  const [cut, setCut] = useState<CinematicCut>(initialCut);
  const [frame, setFrame] = useState(() =>
    cinematicFrame(route, initialCut, 0),
  );
  const [playing, setPlaying] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [status, setStatus] =
    useState<CinematicRendererStatus>(INITIAL_STATUS);

  const commitFrame = (nextFrame: typeof frame) => {
    elapsedRef.current = nextFrame.elapsedSeconds;
    rendererRef.current?.setFrame(nextFrame, renderMode);
    soundRef.current?.update(nextFrame, soundEnabled);
    setFrame(nextFrame);
  };

  const setPlayback = (next: boolean) => {
    playingRef.current = next;
    setPlaying(next);
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const initial = cinematicFrame(route, cut, 0);
    const renderer = new NativeCinematicRenderer();
    const sound = new CinematicSoundscape();
    rendererRef.current = renderer;
    soundRef.current = sound;
    elapsedRef.current = 0;
    setFrame(initial);
    setStatus(INITIAL_STATUS);

    void renderer.mount({
      container,
      frame: initial,
      route,
      onStatus: setStatus,
    });

    return () => {
      setPlayback(false);
      renderer.destroy();
      sound.destroy();
      if (rendererRef.current === renderer) rendererRef.current = undefined;
      if (soundRef.current === sound) soundRef.current = undefined;
    };
  }, [route]);

  useEffect(() => {
    if (!renderMode) return;
    const seek = (event: Event) => {
      const seconds = (event as CustomEvent<{ seconds?: number }>).detail
        ?.seconds;
      if (typeof seconds !== "number" || !Number.isFinite(seconds)) return;
      setPlayback(false);
      commitFrame(cinematicFrame(route, cut, seconds));
    };
    window.addEventListener("godiesel:route-film-seek", seek);
    return () => window.removeEventListener("godiesel:route-film-seek", seek);
  }, [cut, renderMode, route, soundEnabled]);

  useEffect(() => {
    if (status.state !== "ready" && status.state !== "partial") return;
    let animationFrame = 0;
    let previous = performance.now();
    let lastUiUpdate = previous;
    const tick = (now: number) => {
      const delta = Math.min(0.08, (now - previous) / 1_000);
      previous = now;
      if (playingRef.current) {
        const next = cinematicFrame(route, cut, elapsedRef.current + delta);
        elapsedRef.current = next.elapsedSeconds;
        rendererRef.current?.setFrame(next);
        soundRef.current?.update(next, soundEnabled);
        if (now - lastUiUpdate > 70 || next.showDecision) {
          setFrame(next);
          lastUiUpdate = now;
        }
        if (next.elapsedSeconds >= next.durationSeconds) setPlayback(false);
      }
      animationFrame = requestAnimationFrame(tick);
    };
    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [cut, route, soundEnabled, status.state]);

  const selectCut = (nextCut: CinematicCut) => {
    setPlayback(false);
    setCut(nextCut);
    commitFrame(cinematicFrame(route, nextCut, 0));
  };

  const play = async () => {
    if (frame.showDecision) commitFrame(cinematicFrame(route, cut, 0));
    if (soundEnabled) await soundRef.current?.start();
    setPlayback(true);
  };

  const restart = async () => {
    commitFrame(cinematicFrame(route, cut, 0));
    if (soundEnabled) await soundRef.current?.start();
    setPlayback(true);
  };

  const scrub = (progress: number) => {
    setPlayback(false);
    commitFrame(
      cinematicFrame(route, cut, frame.durationSeconds * progress),
    );
  };

  const ready = status.state === "ready" || status.state === "partial";
  const preRoll =
    !renderMode && ready && frame.elapsedSeconds === 0 && !playing;
  const profile = cinematicProfile(route);
  const invitation = routeInvitation(route);
  const recordedLight = recordedLightAt(
    route.route,
    route.provenance.temporal,
    frame.routeProgressM,
  );
  const grade = recordedGrade(recordedLight.phase);

  return (
    <section
      aria-label={`Cinematic director for ${route.name}`}
      className="fixed inset-0 z-[110] overflow-hidden bg-[#050707] text-white"
      data-chapter={frame.chapter}
      data-cut={cut}
      data-duration={frame.durationSeconds}
      data-frame-seconds={frame.elapsedSeconds.toFixed(3)}
      data-light-phase={recordedLight.phase}
      data-render-mode={renderMode ? "true" : "false"}
      data-shot-count={frame.shotCount}
      data-shot-kind={frame.shotKind}
      data-shot-timeline={JSON.stringify(cinematicShotTimeline(route, cut))}
      data-state={status.state}
      data-terrain-character={profile.character}
      data-terrain-relief={frame.terrainReliefM.toFixed(1)}
      data-testid="cinematic-director"
      data-visual-moment-score={frame.visualMomentScore.toFixed(3)}
    >
      <div
        aria-label={`Photorealistic cinematic view of ${route.name}`}
        className="absolute inset-0"
        data-route-points={route.route.length}
        data-testid="cinematic-world"
        ref={containerRef}
        style={{
          filter: [
            `brightness(${frame.look.exposure})`,
            `contrast(${frame.look.contrast})`,
            `saturate(${frame.look.saturation})`,
            `sepia(${grade.sepia})`,
            `hue-rotate(${grade.hue}deg)`,
            `blur(${(frame.cutPulse * 0.7).toFixed(2)}px)`,
          ].join(" "),
        }}
      />
      <RecordedLightLayer light={recordedLight} reducedMotion={renderMode} />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[2] bg-[linear-gradient(180deg,rgba(3,5,5,0.62)_0%,transparent_24%,transparent_64%,rgba(3,5,5,0.92)_100%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[3]"
        style={{
          boxShadow: `inset 0 0 ${8 + frame.look.vignette * 18}rem rgba(0,0,0,${0.28 + frame.look.vignette * 0.82})`,
        }}
      />
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 z-[4] mix-blend-color ${
          cut === "kinetic"
            ? "bg-[#2f6f77]/7"
            : cut === "intimate"
              ? "bg-[#8b704e]/12"
              : "bg-[#2c4251]/11"
        }`}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[5] mix-blend-screen"
        style={{
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.2) 0%, rgba(255,255,255,0.04) 18%, transparent 48%)",
          opacity: frame.look.bloom,
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[6] mix-blend-soft-light"
        style={{
          background:
            "repeating-conic-gradient(from 12deg at 50% 50%, rgba(255,255,255,0.025) 0deg 0.08deg, rgba(0,0,0,0.022) 0.08deg 0.16deg)",
          opacity: 0.14,
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-10 bg-black transition-opacity duration-75"
        style={{ opacity: frame.showDecision ? 0 : frame.cutPulse * 0.88 }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 z-20 h-[7dvh] bg-black"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-[7dvh] bg-black"
      />

      {!renderMode ? (
        <div className="absolute inset-x-0 top-0 z-30 flex items-center justify-between px-5 pt-6 sm:px-8 sm:pt-8">
        <Link
          aria-label="Back to route intelligence"
          className="grid size-10 place-items-center border border-white/28 bg-black/38 backdrop-blur-md transition-colors hover:bg-black/68"
          to="/lab/route-intelligence"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
        </Link>
        <div className="text-right text-[0.64rem] font-semibold uppercase tracking-[0.18em] text-white/62">
          <span className="text-[#ff896d]">goDiesel</span>
          <span className="mx-2 text-white/28">/</span>
          Route film
        </div>
        </div>
      ) : null}

      {preRoll ? (
        <div
          className="absolute inset-0 z-20 grid place-items-center bg-black/44 px-5 py-24 backdrop-blur-[2px]"
          data-testid="cinematic-preroll"
        >
          <div className="w-full max-w-5xl">
            <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-end">
              <div>
                <p className="text-[0.67rem] font-semibold uppercase tracking-[0.24em] text-[#ff896d]">
                  One real day · Reframed as cinema
                </p>
                <h1 className="mt-4 max-w-4xl font-editorial text-6xl font-semibold leading-[0.86] sm:text-8xl">
                  {route.name}
                </h1>
                <p className="mt-6 max-w-2xl text-base leading-relaxed text-white/68 sm:text-lg">
                  {routeLogline(route)}
                </p>
                <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-xs uppercase tracking-[0.12em] text-white/58">
                  <span>{route.distanceKm.toFixed(1)} km</span>
                  <span>{route.elevationGainM.toLocaleString()} m up</span>
                  <span>{route.type}</span>
                  <span>{route.date}</span>
                </div>
              </div>
              <div>
                <div
                  aria-label="Choose a director cut"
                  className="grid border-y border-white/24"
                  role="group"
                >
                  {(Object.keys(CINEMATIC_CUT_LABELS) as CinematicCut[]).map(
                    (option) => (
                      <button
                        aria-pressed={cut === option}
                        className={`border-b border-white/14 px-4 py-4 text-left transition-colors last:border-b-0 ${
                          cut === option
                            ? "bg-white/12 text-white"
                            : "text-white/52 hover:bg-white/7 hover:text-white"
                        }`}
                        key={option}
                        onClick={() => selectCut(option)}
                        type="button"
                      >
                        <span className="block text-sm font-semibold uppercase tracking-[0.14em]">
                          {CINEMATIC_CUT_LABELS[option]}
                        </span>
                        <span className="mt-1 block text-xs leading-relaxed text-white/52">
                          {CUT_DESCRIPTIONS[option]}
                        </span>
                      </button>
                    ),
                  )}
                </div>
                <Button
                  className="mt-4 h-12 w-full bg-[#f16c4b] text-white hover:bg-[#d95639]"
                  onClick={() => void play()}
                >
                  <Play aria-hidden="true" />
                  Play {CINEMATIC_CUT_LABELS[cut]}
                </Button>
                <p className="mt-3 flex items-center justify-center gap-2 text-[0.65rem] uppercase tracking-[0.14em] text-white/42">
                  <Headphones aria-hidden="true" className="size-3" />
                  Sound designed for headphones
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {ready && !preRoll && !frame.showDecision && frame.showChapterTitle ? (
        <div
          aria-live="polite"
          className="pointer-events-none absolute inset-x-5 bottom-[14dvh] z-20 sm:inset-x-8"
          data-testid="cinematic-chapter"
        >
          <div className="h-px w-14 bg-[#f16c4b]" />
          <p className="mt-3 text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-white/52">
            Chapter {String(frame.shotIndex + 1).padStart(2, "0")} ·{" "}
            {frame.shotKind}
          </p>
          <h2 className="mt-1 max-w-4xl font-editorial text-4xl font-semibold leading-none sm:text-6xl">
            {frame.chapter}
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/66 sm:text-base">
            {frame.chapterSubtitle}
          </p>
        </div>
      ) : null}

      {frame.showDecision ? (
        <div
          className="absolute inset-x-0 bottom-12 z-20 border-y border-white/20 bg-black/72 px-5 py-6 backdrop-blur-md sm:bottom-14 sm:px-8 sm:py-8"
          data-testid="cinematic-decision"
        >
          <div className="mx-auto grid max-w-7xl gap-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <div>
              <p className="text-[0.67rem] font-semibold uppercase tracking-[0.22em] text-[#ff896d]">
                {invitation.eyebrow}
              </p>
              <h1 className="mt-2 font-editorial text-5xl font-semibold leading-none sm:text-7xl">
                {invitation.title}
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-relaxed text-white/62">
                You have seen the shape of {route.name}. Now meet the real
                terrain: {route.distanceKm.toFixed(1)} km and{" "}
                {route.elevationGainM.toLocaleString()} m up.
              </p>
            </div>
            {!renderMode ? (
              <div className="flex flex-wrap gap-2">
              <Button
                className="border-white/34 bg-transparent text-white hover:bg-white/12"
                onClick={() => void restart()}
                variant="outline"
              >
                <RotateCcw aria-hidden="true" />
                Another viewing
              </Button>
              <Button asChild className="bg-[#f16c4b] text-white hover:bg-[#d95639]">
                <Link to={`/lab/google-route-navigator/${route.slug}`}>
                  {invitation.action}
                  <ChevronRight aria-hidden="true" />
                </Link>
              </Button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {!ready ? (
        <div className="absolute inset-0 z-40 grid place-items-center bg-[#050707] p-6">
          <div
            aria-live="polite"
            className="max-w-md text-center"
            role={status.state === "unavailable" ? "alert" : "status"}
          >
            <ScanLine className="mx-auto size-5 text-[#f16c4b]" />
            <h2 className="mt-4 font-editorial text-4xl font-semibold">
              {status.state === "loading"
                ? "Staging the landscape"
                : "The landscape could not be staged"}
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-white/58">
              {status.message}
            </p>
          </div>
        </div>
      ) : null}

      {ready && !preRoll && !renderMode ? (
        <div className="absolute inset-x-5 bottom-[1.5dvh] z-30 flex items-center gap-3 sm:inset-x-8">
          <button
            aria-label={playing ? "Pause cinematic" : "Play cinematic"}
            className="grid size-9 shrink-0 place-items-center border border-white/28 bg-black/45 backdrop-blur-md hover:bg-black/72"
            onClick={() => (playing ? setPlayback(false) : void play())}
            type="button"
          >
            {playing ? (
              <Pause aria-hidden="true" className="size-3.5" />
            ) : (
              <Play aria-hidden="true" className="size-3.5" />
            )}
          </button>
          <input
            aria-label="Cinematic progress"
            className="h-9 min-w-0 flex-1 accent-[#f16c4b]"
            data-testid="cinematic-progress"
            max="1"
            min="0"
            onChange={(event) => scrub(Number(event.currentTarget.value))}
            step="0.001"
            type="range"
            value={frame.progress}
          />
          <span className="hidden min-w-16 text-right text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-white/44 md:block">
            {Math.round(frame.lensMm)} mm
          </span>
          <button
            aria-label={soundEnabled ? "Mute soundscape" : "Enable soundscape"}
            className="grid size-9 shrink-0 place-items-center border border-white/28 bg-black/45 backdrop-blur-md hover:bg-black/72"
            onClick={() => {
              const next = !soundEnabled;
              setSoundEnabled(next);
              soundRef.current?.update(frame, next);
            }}
            type="button"
          >
            {soundEnabled ? (
              <Volume2 aria-hidden="true" className="size-3.5" />
            ) : (
              <VolumeX aria-hidden="true" className="size-3.5" />
            )}
          </button>
          <Link
            aria-label="Open route guide"
            className="hidden h-9 items-center gap-2 border border-white/28 bg-black/45 px-3 text-xs font-medium backdrop-blur-md hover:bg-black/72 sm:inline-flex"
            to={`/routes/${route.slug}`}
          >
            <RouteIcon aria-hidden="true" className="size-3.5" />
            Route guide
          </Link>
        </div>
      ) : null}
    </section>
  );
}
