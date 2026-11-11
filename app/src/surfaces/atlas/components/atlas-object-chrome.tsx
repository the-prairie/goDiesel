import { useEffect, useReducer, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { routeDetailPath } from "@/app/route-paths";
import type { RouteRegion } from "@/data/route-regions";
import type { RouteSummary } from "@/domain/route";
import {
  initialAtlasObject,
  reduceAtlasObject,
} from "@/surfaces/atlas/atlas-object-state";
import type { AtlasPresentationState } from "@/surfaces/atlas/atlas-presentation-state";
import "./atlas-object.css";

interface AtlasObjectChromeProps {
  regions: RouteRegion[];
  selectedRegion?: RouteRegion;
  selectedRoute?: RouteSummary;
  presentation: AtlasPresentationState;
  reducedMotion: boolean;
  onSelectRegion: (region: RouteRegion) => void;
  onSelectRoute: (route: RouteSummary) => void;
  onClearRegion: () => void;
  onClearRoute: () => void;
  onSpin: (radians: number) => void;
  onLight: (mode: "day" | "night" | "flood") => void;
  nearestPlace: (maxPx: number) => string | null;
  routeSparks: () => { slug: string; region: string; width: number; points: { x: number; y: number }[] }[];
  replayPathForRoute: (route: RouteSummary) => string;
}

export function AtlasObjectChrome({
  regions,
  selectedRegion,
  selectedRoute,
  presentation,
  reducedMotion,
  onSelectRegion,
  onSelectRoute,
  onClearRegion,
  onClearRoute,
  onSpin,
  onLight,
  nearestPlace,
  routeSparks,
  replayPathForRoute,
}: AtlasObjectChromeProps) {
  const [state, dispatch] = useReducer(
    reduceAtlasObject,
    initialAtlasObject(selectedRegion?.name ?? null, selectedRoute?.slug ?? null),
  );
  const [held, setHeld] = useState(false);
  const [sparks, setSparks] = useState<{ slug: string; region: string; width: number; points: { x: number; y: number }[] }[]>([]);
  const [sound, setSound] = useState(false);
  const audio = useRef<AudioContext | null>(null);
  const selectRegionRef = useRef(onSelectRegion);
  selectRegionRef.current = onSelectRegion;
  const divingPlace = state.phase === "diving" ? state.place : null;
  const tuned = state.phase === "orbit" ? state.tuned : null;

  useEffect(() => {
    onLight(state.phase === "landed" ? "flood" : "night");
  }, [onLight, presentation.status.state, state.phase]);

  useEffect(() => () => onLight("day"), [onLight]);

  useEffect(() => {
    if (!divingPlace) return;
    const region = regions.find((item) => item.name === divingPlace);
    if (region) selectRegionRef.current(region);
  }, [divingPlace, regions]);

  useEffect(() => {
    if (state.phase !== "diving") return;
    const status = presentation.status.state;
    const landed = status === "region-ready"
      || status === "region-fallback"
      || presentation.region.state === "ready";
    if (landed) dispatch({ type: "arrived" });
  }, [presentation.region.state, presentation.status.state, state.phase]);

  const nearestRef = useRef(nearestPlace);
  const sparksRef = useRef(routeSparks);
  nearestRef.current = nearestPlace;
  sparksRef.current = routeSparks;

  useEffect(() => {
    if (state.phase !== "orbit") return;
    const id = window.setInterval(() => {
      dispatch({ type: "retune", place: nearestRef.current(84) });
      setSparks(sparksRef.current());
    }, 140);
    return () => window.clearInterval(id);
  }, [state.phase]);

  useEffect(() => {
    if (!tuned || reducedMotion || !held) return;
    const id = window.setTimeout(() => dispatch({ type: "commit" }), 1100);
    return () => window.clearTimeout(id);
  }, [held, reducedMotion, tuned]);

  useEffect(() => {
    if (reducedMotion || state.phase !== "orbit") return;
    let frame = 0;
    let last = performance.now();
    let alive = true;
    const stop = () => {
      alive = false;
    };
    const arm = () => setHeld(true);
    const tick = (now: number) => {
      if (!alive) return;
      const elapsed = Math.min(0.05, (now - last) / 1000);
      last = now;
      onSpin(elapsed * 0.025);
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    window.addEventListener("pointerdown", stop, { once: true });
    window.addEventListener("pointerup", arm);
    return () => {
      alive = false;
      window.cancelAnimationFrame(frame);
      window.removeEventListener("pointerdown", stop);
      window.removeEventListener("pointerup", arm);
    };
  }, [onSpin, reducedMotion, state.phase]);

  useEffect(() => {
    const section = document.querySelector(".atlas-layout");
    section?.setAttribute("data-atlas-light", state.phase);
  }, [state.phase]);

  useEffect(() => {
    if (!sound || !tuned || !audio.current) return;
    const context = audio.current;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    oscillator.type = "sine";
    oscillator.frequency.value = 174 + (tuned.length % 10) * 22;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.04, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.6);
  }, [sound, tuned]);

  const tunedRegion = regions.find((region) => region.name === tuned);
  const landedRegion = state.phase === "landed"
    ? regions.find((region) => region.name === state.place)
    : undefined;
  const focused = landedRegion?.routes.find((route) => route.slug === (state.phase === "landed" ? state.focus : null));

  function enableSound() {
    if (!audio.current) audio.current = new AudioContext();
    void audio.current.resume();
    setSound((value) => !value);
  }

  function stepBack() {
    if (state.phase === "landed" && state.focus) {
      dispatch({ type: "release" });
      onClearRoute();
      return;
    }
    dispatch({ type: "ascend" });
    onClearRegion();
  }

  return (
    <>
      {state.phase === "orbit" ? <div className="atlas-object-night" aria-hidden="true" /> : null}
      {state.phase === "orbit" && sparks.length > 0 ? (
        <svg className="atlas-object-sparks" aria-hidden="true">
          {placeLights(sparks).map((light) => (
            <g key={light.name}>
              <circle cx={light.x} cy={light.y} r={16 + light.count * 2} fill="#ffd36a" opacity="0.28" />
              <circle cx={light.x} cy={light.y} r={4 + light.count} fill="#fff6df" />
            </g>
          ))}
        </svg>
      ) : null}
      {state.phase === "orbit" ? (
        <div className="atlas-object-reticle" data-testid="atlas-object-reticle" aria-hidden="true" />
      ) : null}
      {state.phase !== "orbit" ? (
        <button type="button" className="atlas-object-back" onClick={stepBack}>
          {state.phase === "landed" && state.focus ? "All routes here" : "Back to the night"}
        </button>
      ) : null}
      <button
        type="button"
        className="atlas-object-sound"
        aria-pressed={sound}
        onClick={enableSound}
      >
        {sound ? "Sound on" : "Sound off"}
      </button>
      {state.phase === "orbit" && tunedRegion ? (
        <button
          type="button"
          className="atlas-object-tune"
          data-testid="atlas-object-tune"
          onClick={() => dispatch({ type: "commit" })}
        >
          {tunedRegion.name}
          <small>{yearsOf(tunedRegion)} · Enter</small>
        </button>
      ) : null}
      {state.phase === "landed" && landedRegion && !state.focus ? (
        <ul className="atlas-object-ghosts" data-testid="atlas-object-ghosts">
          {landedRegion.routes.map((route) => (
            <li key={route.slug}>
              <button
                type="button"
                className="atlas-object-ghost"
                aria-label={`Focus ${route.date.slice(0, 10)}`}
                onClick={() => {
                  dispatch({ type: "focus", slug: route.slug });
                  onSelectRoute(route);
                }}
              >
                {route.date.slice(0, 10)}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {state.phase === "landed" && focused ? (
        <FocusCard route={focused} replayPath={replayPathForRoute(focused)} />
      ) : null}
      {state.phase === "landed" && !reducedMotion ? <div className="atlas-object-flood" aria-hidden="true" /> : null}
    </>
  );
}

function FocusCard({ route, replayPath }: { route: RouteSummary; replayPath: string }) {
  const replayable = route.lifecycle !== "planned"
    && route.replay.geometryStatus === "ready"
    && route.replay.replayEligible;
  return (
    <section className="atlas-object-focus" data-testid="atlas-object-focus" aria-label={route.name}>
      <p>{route.region} · {route.date.slice(0, 10)}</p>
      <h1>{route.name}</h1>
      <p>
        {route.distanceKm.toFixed(1)} km · {route.elevationGainM.toLocaleString()} m up · {route.type}
      </p>
      <Link className="atlas-object-replay" to={replayable ? replayPath : routeDetailPath(route.slug)}>
        {replayable ? "Replay" : "Route guide"}
      </Link>
    </section>
  );
}

function yearsOf(region: RouteRegion) {
  const years = [...new Set(region.routes.map((route) => route.date.slice(0, 4)).filter(Boolean))].sort();
  if (years.length === 0) return "Recorded";
  if (years.length === 1) return years[0];
  return `${years[0]} to ${years.at(-1)}`;
}

function placeLights(sparks: { region?: string; points: { x: number; y: number }[] }[]) {
  const places = new Map<string, { x: number; y: number; count: number }>();
  for (const spark of sparks) {
    const name = spark.region ?? spark.points.length.toString();
    const point = spark.points[Math.floor(spark.points.length / 2)];
    const current = places.get(name) ?? { x: point.x, y: point.y, count: 0 };
    current.count += 1;
    places.set(name, current);
  }
  return [...places.entries()].map(([name, light]) => ({ name, ...light }));
}
