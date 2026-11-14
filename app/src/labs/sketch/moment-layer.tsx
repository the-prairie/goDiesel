import { Suspense, lazy, useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";

import maplibregl from "@/providers/maplibre";
import { plantMoments } from "@/labs/sketch/sketch-moment-markers";
import { initialMomentState, reduceMoment, type MomentCamera } from "@/labs/sketch/sketch-moment-state";
import { EXAMPLE_MOMENTS, approachCamera, chooseMoments, momentDataSaving, shownMoments, type CatalogEntry, type Placement } from "@/labs/sketch/moment-catalog";

// Planted moments in the drawn world: loaded once the map is up, in its own
// chunk, so the world itself carries almost nothing for them. Places a button
// on each placed moment's building; tapping one takes the camera to the
// shop's front, opens its scene (each kind its own chunk) and, on leaving,
// puts the camera back where she was and focus back on the button.

const SCENES = { "tv-wall": lazy(() => import("@/labs/sketch/moment-tv-wall")) };

export interface MomentLayerProps {
  map: MapLibreMap;
  move: (camera: MomentCamera, duration?: number) => Promise<void>;
  reducedMotion: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function MomentLayer({ map, move, reducedMotion, onOpenChange }: MomentLayerProps) {
  const [moments, setMoments] = useState(EXAMPLE_MOMENTS);
  useEffect(() => {
    fetch("/moments/moments.json", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setMoments(chooseMoments(data)))
      .catch(() => undefined);
  }, []);
  const [moment, send] = useReducer(reduceMoment, undefined, initialMomentState);
  const opener = useRef<{ placement: Placement; entry: CatalogEntry; button: HTMLElement } | null>(null);
  useEffect(
    () =>
      plantMoments(map, maplibregl, shownMoments(moments), (placement, entry, button) => {
        opener.current = { placement, entry, button };
        const center = map.getCenter();
        send({ type: "tapped", id: placement.id, from: { center: [center.lng, center.lat], zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() }, saveData: momentDataSaving(), clip: Boolean(entry.clip) });
      }),
    [map, moments],
  );
  useEffect(() => {
    onOpenChange(moment.phase !== "closed");
    if (moment.phase === "approaching" && opener.current) void move(approachCamera(opener.current.placement), 2200).then(() => send({ type: "arrived" }));
    if (moment.phase === "leaving") {
      map.jumpTo(moment.from);
      send({ type: "left" });
    }
    // Focus goes back to the moment once the world is no longer inert behind it.
    if (moment.phase === "closed" && opener.current) {
      const button = opener.current.button;
      const frame = requestAnimationFrame(() => button.focus({ preventScroll: true }));
      return () => cancelAnimationFrame(frame);
    }
  }, [map, moment, move, onOpenChange]);
  const back = useCallback(() => send({ type: "backRequested" }), []);
  const sound = useCallback(() => send({ type: "soundToggled" }), []);
  const play = useCallback(() => send({ type: "playRequested" }), []);
  const ready = useCallback(() => send({ type: "mediaReady" }), []);
  const failed = useCallback(() => send({ type: "mediaFailed" }), []);
  if (moment.phase !== "open" || !opener.current) return null;
  const Scene = SCENES[opener.current.entry.kind];
  return (
    <Suspense fallback={null}>
      <Scene entry={opener.current.entry} media={moment.media} onBack={back} onFailed={failed} onPlay={play} onReady={ready} onSound={sound} reducedMotion={reducedMotion} sound={moment.sound} />
    </Suspense>
  );
}
