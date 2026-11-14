import { Suspense, lazy, useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";

import { plantMoments } from "@/labs/sketch/sketch-moment-markers";
import { initialMomentState, reduceMoment, type MomentCamera } from "@/labs/sketch/sketch-moment-state";
import { frontCorners, type ScreenFront } from "@/labs/sketch/moment-handover";
import { EXAMPLE_MOMENTS, approachCamera, chooseMoments, momentDataSaving, shownMoments, type CatalogEntry, type Placement } from "@/labs/sketch/moment-catalog";

// Planted moments in the drawn world: loaded once the map is up, in its own
// chunk, so the world itself carries almost nothing for them. Places a button
// on each placed moment's building; tapping one takes the camera to the
// shop's front, opens its scene (each kind its own chunk) and, on leaving,
// puts the camera back where she was and focus back on the button.

const SCENES = { "tv-wall": lazy(() => import("@/labs/sketch/moment-tv-wall")) };
const Review = lazy(() => import("@/labs/sketch/moment-review"));

export interface MomentLayerProps {
  map: MapLibreMap;
  move: (camera: MomentCamera, duration?: number) => Promise<void>;
  reducedMotion: boolean;
  /** Review mode (?review=1): placing and swapping instead of opening. */
  review?: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function MomentLayer({ map, move, reducedMotion, review, onOpenChange }: MomentLayerProps) {
  const [moments, setMoments] = useState(EXAMPLE_MOMENTS);
  useEffect(() => {
    fetch("/moments/moments.json", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setMoments(chooseMoments(data)))
      .catch(() => undefined);
  }, []);
  const [moment, send] = useReducer(reduceMoment, undefined, initialMomentState);
  const opener = useRef<{ placement: Placement; entry: CatalogEntry; button: HTMLElement } | null>(null);
  const handover = useRef<ScreenFront | null>(null);
  const placementTap = useRef<((placement: Placement) => void) | null>(null);
  useEffect(
    () =>
      plantMoments(map, shownMoments(moments), (placement, entry, button) => {
        if (placementTap.current) return placementTap.current(placement);
        opener.current = { placement, entry, button };
        const center = map.getCenter();
        send({ type: "tapped", id: placement.id, from: { center: [center.lng, center.lat], zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() }, saveData: momentDataSaving(), clip: Boolean(entry.clip) });
      }, reducedMotion),
    [map, moments, reducedMotion],
  );
  useEffect(() => {
    onOpenChange(moment.phase !== "closed");
    if (moment.phase === "approaching" && opener.current) {
      const placement = opener.current.placement;
      void move(approachCamera(placement), 2200).then(() => {
        // Where her building's front stands now, for the scene to start on.
        const [a, b] = frontCorners(placement).map((c) => map.project([c.lng, c.lat]));
        handover.current = { left: Math.min(a.x, b.x), right: Math.max(a.x, b.x), ground: (a.y + b.y) / 2 };
        send({ type: "arrived" });
      });
    }
    if (moment.phase === "leaving") {
      map.jumpTo(moment.from);
      send({ type: "left" });
    }
    // Focus goes back to the moment once the world is no longer inert behind it.
    if (moment.phase === "closed" && opener.current) {
      const button = opener.current.button;
      // The world wakes in its own render, which can land a frame or two later.
      let tries = 0;
      let frame = 0;
      const focus = () => {
        if (button.closest("[inert]") && (tries += 1) < 30) frame = requestAnimationFrame(focus);
        else button.focus({ preventScroll: true });
      };
      frame = requestAnimationFrame(focus);
      return () => cancelAnimationFrame(frame);
    }
  }, [map, moment, move, onOpenChange]);
  const back = useCallback(() => send({ type: "backRequested" }), []);
  const sound = useCallback(() => send({ type: "soundToggled" }), []);
  const play = useCallback(() => send({ type: "playRequested" }), []);
  const ready = useCallback(() => send({ type: "mediaReady" }), []);
  const failed = useCallback(() => send({ type: "mediaFailed" }), []);
  const reviewing = review ? (
    <Suspense fallback={null}>
      <Review data={moments} map={map} placementTap={placementTap} setData={setMoments} />
    </Suspense>
  ) : null;
  if (moment.phase !== "open" || !opener.current) return reviewing;
  const Scene = SCENES[opener.current.entry.kind];
  return (
    <Suspense fallback={null}>
      {reviewing}
      <Scene entry={opener.current.entry} from={reducedMotion ? null : handover.current} media={moment.media} onBack={back} onFailed={failed} onPlay={play} onReady={ready} onSound={sound} reducedMotion={reducedMotion} sound={moment.sound} />
    </Suspense>
  );
}
