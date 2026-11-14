import { useEffect, useReducer, useRef } from "react";
import type { Map as MapLibreMap, MapMouseEvent, Marker } from "maplibre-gl";

import maplibregl from "@/providers/maplibre";
import { initialAssignState, reduceAssign, type AssignEvent } from "@/labs/sketch/moment-assign-state";
import type { MomentsData, Placement } from "@/labs/sketch/moment-catalog";
import { footprintAt, streetFronts } from "@/labs/sketch/moment-place";
import ReviewReadout from "@/labs/sketch/moment-review-readout";
import "@/labs/sketch/moment-review.css";

// Review mode (?review=1): placing, swapping and removing her moments on the
// map, saved through the loopback owner writer (ADR-0010) to her private
// moments file. Loaded only in review mode.

const WRITER = import.meta.env.VITE_ADMIN_API_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:8766";
const BUILDINGS = ["building-3d", "building-plan"];
const ROADS = ["road-major", "road-mid", "road-minor"];

async function writer(path: string, init?: RequestInit) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 1500);
  try {
    return await fetch(`${WRITER}${path}`, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

export interface MomentReviewProps {
  map: MapLibreMap;
  data: MomentsData;
  setData: (data: MomentsData) => void;
  /** The layer hands taps on placed moments here while reviewing. */
  placementTap: { current: ((placement: Placement) => void) | null };
}

export default function MomentReview({ map, data, setData, placementTap }: MomentReviewProps) {
  const [state, send] = useReducer(reduceAssign, undefined, initialAssignState);
  const dataRef = useRef(data);
  dataRef.current = data;

  // Is the writer here (her laptop), and what does it hold?
  useEffect(() => {
    let gone = false;
    writer("/api/admin/status")
      .then(async (response) => {
        const ok = response.ok && (await response.json()).writer_available === true;
        if (ok) {
          const held = await writer("/api/admin/moments");
          const body = held.ok ? await held.json() : null;
          if (!gone && body?.moments) setData(body.moments);
        }
        if (!gone) send({ type: "writerChecked", available: ok });
      })
      .catch(() => !gone && send({ type: "writerChecked", available: false }));
    return () => {
      gone = true;
    };
  }, [setData]);

  // Taps: a placed moment to edit it, a building to place one.
  useEffect(() => {
    placementTap.current = (placement) => send({ type: "placementTapped", id: placement.id });
    const onClick = (event: MapMouseEvent) => {
      const hit = map.queryRenderedFeatures(event.point, { layers: BUILDINGS.filter((id) => map.getLayer(id)) });
      const point: [number, number] = [event.lngLat.lng, event.lngLat.lat];
      const ring = hit.map((feature) => footprintAt(feature.geometry as never, point)).find(Boolean);
      if (!ring) return;
      const { x, y } = event.point;
      const roads = map
        .queryRenderedFeatures([[x - 90, y - 90], [x + 90, y + 90]], { layers: ROADS.filter((id) => map.getLayer(id)) })
        .flatMap((feature) => (feature.geometry.type === "LineString" ? [feature.geometry.coordinates] : feature.geometry.type === "MultiLineString" ? feature.geometry.coordinates : [])) as [number, number][][];
      send({ type: "buildingTapped", fronts: streetFronts(ring, roads) });
    };
    map.on("click", onClick);
    return () => {
      placementTap.current = null;
      map.off("click", onClick);
    };
  }, [map, placementTap]);

  // Where the new moment would stand.
  const ghost = useRef<Marker | null>(null);
  const front = state.phase === "placing" ? state.fronts[state.front] : null;
  useEffect(() => {
    if (!front) return;
    const element = document.createElement("div");
    element.className = "moment-review-ghost";
    ghost.current = new maplibregl.Marker({ element, anchor: "bottom", rotation: 0 }).setLngLat([front.at.lng, front.at.lat]).addTo(map);
    return () => {
      ghost.current?.remove();
      ghost.current = null;
    };
  }, [front, map]);

  // Saving: shown at once, written whole, and put back if the writer refuses.
  useEffect(() => {
    if (state.phase !== "saving") return;
    setData(state.next);
    writer("/api/admin/moments", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state.next) })
      .then(async (response) => {
        if (response.ok) send({ type: "saved" });
        else send({ type: "saveFailed", message: ((await response.json().catch(() => ({}))) as { error?: string }).error ?? `The writer said ${response.status}.` });
      })
      .catch(() => send({ type: "saveFailed", message: "The writer stopped answering." }));
  }, [setData, state]);
  useEffect(() => {
    if (state.phase === "failed") setData(state.kept);
  }, [setData, state]);

  const act = (event: AssignEvent) => send(event);
  const current = state.phase === "editing" ? dataRef.current.placements.find((p) => p.id === state.placementId) : undefined;
  const title = (id: string | null | undefined) => dataRef.current.catalog.find((entry) => entry.id === id)?.title ?? "nothing";

  let sheet: React.ReactNode = null;
  if (state.phase === "blocked")
    sheet = (
      <>
        <p className="moment-review-title">Placing moments works on the laptop.</p>
        <p className="moment-review-note">The writer that saves them only answers on the machine it runs on.</p>
        <button className="moment-review-button" onClick={() => act({ type: "dismissed" })} type="button">OK</button>
      </>
    );
  else if (state.phase === "failed")
    sheet = (
      <>
        <p className="moment-review-title">Not saved. Nothing was changed.</p>
        <p className="moment-review-note">{state.message}</p>
        <button className="moment-review-button" onClick={() => act({ type: "dismissed" })} type="button">OK</button>
      </>
    );
  else if (state.phase === "placing")
    sheet = (
      <>
        <p className="moment-review-title">Place a moment here</p>
        <ul className="moment-review-list">
          {dataRef.current.catalog.map((entry) => (
            <li key={entry.id}>
              <button className="moment-review-button" onClick={() => act({ type: "entryChosen", entryId: entry.id, id: `place-${Date.now().toString(36)}`, data: dataRef.current })} type="button">
                {entry.title}
              </button>
            </li>
          ))}
        </ul>
        <div className="moment-review-row">
          {state.fronts.length > 1 ? (
            <button className="moment-review-button" onClick={() => act({ type: "turned" })} type="button">Turn to another side</button>
          ) : null}
          <button className="moment-review-button" onClick={() => act({ type: "cancelled" })} type="button">Cancel</button>
        </div>
      </>
    );
  else if (state.phase === "editing" && current)
    sheet = (
      <>
        <p className="moment-review-title">Here: {title(current.entryId)}</p>
        <ul className="moment-review-list">
          {dataRef.current.catalog
            .filter((entry) => entry.id !== current.entryId)
            .map((entry) => (
              <li key={entry.id}>
                <button className="moment-review-button" onClick={() => act({ type: "swapChosen", entryId: entry.id, data: dataRef.current })} type="button">
                  Swap to {entry.title}
                </button>
              </li>
            ))}
        </ul>
        <div className="moment-review-row">
          <button className="moment-review-button moment-review-danger" onClick={() => act({ type: "removeRequested", data: dataRef.current })} type="button">Remove from here</button>
          <button className="moment-review-button" onClick={() => act({ type: "cancelled" })} type="button">Cancel</button>
        </div>
      </>
    );

  return (
    <>
      <ReviewReadout map={map} />
      <p aria-live="polite" className="moment-review-status" data-phase={state.phase} data-testid="moment-review">
        {state.phase === "saving" ? "Saving…" : state.phase === "ready" ? (state.writer ? "Tap a building to place a moment." : "Viewing only: placing works on the laptop.") : ""}
      </p>
      {sheet ? (
        <div aria-label="Place a moment" className="moment-review-sheet" role="dialog">
          {sheet}
        </div>
      ) : null}
    </>
  );
}
