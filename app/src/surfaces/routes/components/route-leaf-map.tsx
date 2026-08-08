import { LocateFixed, Minus, Plus } from "lucide-react";
import maplibregl, { LngLatBounds, Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";

import { RepairEvidence } from "@/surfaces/routes/components/repair-evidence";
import { Button } from "@/components/ui/button";
import {
  routeRepairAriaLabel,
  routeRepairs,
  type RouteRepair,
} from "@/domain/route-repairs";
import type { QuestRoute } from "@/domain/routes";

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const ROUTE_COLOR = "#315fb4";
const ROUTE_HALO = "#f6f2e8";

function routeFeature(route: QuestRoute) {
  return {
    type: "Feature" as const,
    properties: {},
    geometry: {
      type: "LineString" as const,
      coordinates: route.route.map((point) => [point.lng, point.lat]),
    },
  };
}

export function RouteLeafMap({ route }: { route: QuestRoute }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | undefined>(undefined);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">(
    route.route.length > 1 ? "loading" : "unavailable",
  );
  const repairs = useMemo(() => routeRepairs(route), [route]);
  const [activeRepairs, setActiveRepairs] = useState<RouteRepair[]>([]);
  const [repairPositions, setRepairPositions] = useState<
    Array<{ id: string; x: number; y: number }>
  >([]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || route.route.length < 2) return;

    let active = true;
    let errorCount = 0;
    let ready = false;
    const bounds = new LngLatBounds();
    route.route.forEach((point) => bounds.extend([point.lng, point.lat]));
    const map = new maplibregl.Map({
      container: host,
      style: STYLE_URL,
      center: [route.centerLng, route.centerLat],
      zoom: 11,
      pitch: 38,
      bearing: 0,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(host);
    const loadTimer = window.setTimeout(() => {
      if (active && !ready) setStatus("unavailable");
    }, 8_000);

    const handleError = () => {
      errorCount += 1;
      if (active && errorCount >= 4 && !ready) setStatus("unavailable");
    };
    const syncRepairPositions = () => {
      setRepairPositions(
        repairs.flatMap((repair) => {
          if (!repair.point) return [];
          const projected = map.project([repair.point.lng, repair.point.lat]);
          return [{ id: repair.id, x: projected.x, y: projected.y }];
        }),
      );
    };
    map.on("error", handleError);
    map.on("move", syncRepairPositions);
    map.on("resize", syncRepairPositions);
    map.once("load", () => {
      if (!active) return;
      map.resize();
      map.addSource("leaf-route", { type: "geojson", data: routeFeature(route) });
      map.addLayer({
        id: "leaf-route-halo",
        type: "line",
        source: "leaf-route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ROUTE_HALO,
          "line-width": 10,
          "line-opacity": 0.9,
        },
      });
      map.addLayer({
        id: "leaf-route-thread",
        type: "line",
        source: "leaf-route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ROUTE_COLOR,
          "line-width": 5,
          "line-opacity": 1,
        },
      });
      const start = route.route[0];
      const finish = route.route.at(-1)!;
      map.addSource("leaf-endpoints", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: { kind: "start" },
              geometry: { type: "Point", coordinates: [start.lng, start.lat] },
            },
            {
              type: "Feature",
              properties: { kind: "finish" },
              geometry: { type: "Point", coordinates: [finish.lng, finish.lat] },
            },
          ],
        },
      });
      map.addLayer({
        id: "leaf-route-start",
        type: "circle",
        source: "leaf-endpoints",
        filter: ["==", ["get", "kind"], "start"],
        paint: {
          "circle-radius": 7,
          "circle-color": "#d95d45",
          "circle-stroke-color": ROUTE_HALO,
          "circle-stroke-width": 3,
        },
      });
      map.addLayer({
        id: "leaf-route-finish",
        type: "circle",
        source: "leaf-endpoints",
        filter: ["==", ["get", "kind"], "finish"],
        paint: {
          "circle-radius": 7,
          "circle-color": "#174f46",
          "circle-stroke-color": ROUTE_HALO,
          "circle-stroke-width": 3,
        },
      });
      map.fitBounds(bounds, {
        padding: { top: 88, right: 64, bottom: 88, left: 64 },
        maxZoom: 14,
        duration: 0,
      });
      syncRepairPositions();
      map.getCanvas().setAttribute("aria-label", `${route.name} interactive route map`);
      map.once("idle", () => {
        if (!active) return;
        ready = true;
        window.clearTimeout(loadTimer);
        setStatus("ready");
      });
    });

    return () => {
      active = false;
      window.clearTimeout(loadTimer);
      resizeObserver.disconnect();
      map.off("error", handleError);
      map.off("move", syncRepairPositions);
      map.off("resize", syncRepairPositions);
      map.remove();
      mapRef.current = undefined;
    };
  }, [repairs, route]);

  function resetView() {
    const map = mapRef.current;
    if (!map || route.route.length < 2) return;
    const bounds = new LngLatBounds();
    route.route.forEach((point) => bounds.extend([point.lng, point.lat]));
    map.fitBounds(bounds, {
      padding: { top: 88, right: 64, bottom: 88, left: 64 },
      maxZoom: 14,
      duration: 450,
    });
  }

  const repairGroups = projectedRepairGroups(repairs, repairPositions);

  return (
    <section
      aria-label="Route geography"
      data-map-status={status}
      data-geometry-points={route.route.length}
      data-route-color={ROUTE_COLOR}
      data-route-halo={ROUTE_HALO}
      className="relative min-h-0 overflow-hidden bg-[#d9ddd2]"
    >
      <div
        ref={hostRef}
        role="img"
        aria-label={`${route.name} recorded path on a real map`}
        className="h-full w-full"
      />

      {status === "ready"
        ? repairs.map((repair) => {
            const position = repairPositions.find(({ id }) => id === repair.id);
            if (!position) return null;
            return (
              <span
                key={repair.id}
                data-testid="leaf-repair-mark"
                aria-hidden="true"
                data-repair-distance-m={repair.distanceM.toFixed(2)}
                className="pointer-events-none absolute z-10 h-7 w-1 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-full bg-repair shadow-[0_0_0_2px_rgba(24,33,29,0.88),0_0_0_4px_rgba(246,242,232,0.92)]"
                style={{ left: position.x, top: position.y }}
              />
            );
          })
        : null}

      {status === "ready"
        ? repairGroups.map((group) => (
            <button
              key={group.repairs.map(({ id }) => id).join("-")}
              type="button"
              aria-label={
                group.repairs.length === 1
                  ? routeRepairAriaLabel(group.repairs[0])
                  : `${group.repairs.length} recorded repairs near ${(
                      group.repairs.reduce((sum, repair) => sum + repair.distanceM, 0) /
                      group.repairs.length /
                      1_000
                    ).toFixed(2)} km`
              }
              className="absolute z-10 size-11 -translate-x-1/2 -translate-y-1/2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-repair focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              style={{ left: group.x, top: group.y }}
              onClick={() => setActiveRepairs(group.repairs)}
            />
          ))
        : null}

      {activeRepairs.length > 0 ? (
        <RepairEvidence
          repairs={activeRepairs}
          className="absolute left-4 top-16 z-20 max-w-[min(22rem,calc(100%-2rem))]"
        />
      ) : null}

      {status === "loading" ? (
        <div
          role="status"
          className="absolute left-4 top-4 rounded-sm border border-line bg-surface/92 px-3 py-2 text-caption text-ink-secondary shadow-panel"
        >
          Opening route geography.
        </div>
      ) : null}
      {status === "unavailable" ? (
        <div className="absolute inset-0 grid place-items-center bg-surface-muted/92 p-6 text-center">
          <div className="max-w-sm">
            <p className="font-semibold text-ink">
              {route.route.length > 1 ? "Map tiles unavailable" : "Recorded path unavailable"}
            </p>
            <p className="mt-2 text-control leading-6 text-ink-muted">
              {route.route.length > 1
                ? "The recorded route is intact, but source-backed map tiles could not load in this session."
                : "This route has no usable GPS geometry to place on the map."}
            </p>
          </div>
        </div>
      ) : null}

      {route.route.length > 1 ? (
        <>
          <div className="absolute right-4 top-4 z-10 flex gap-3 rounded-sm border border-line bg-surface/92 px-3 py-2 text-caption font-semibold text-ink-secondary shadow-panel backdrop-blur">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-coral" aria-hidden="true" />
              Start
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-forest" aria-hidden="true" />
              Finish
            </span>
          </div>
          <div className="absolute bottom-4 left-4 z-10 flex gap-1 rounded-sm border border-line bg-surface/92 p-1 shadow-panel backdrop-blur">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Reset route map"
              onClick={resetView}
            >
              <LocateFixed aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Zoom route map out"
              onClick={() => mapRef.current?.zoomOut()}
            >
              <Minus aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Zoom route map in"
              onClick={() => mapRef.current?.zoomIn()}
            >
              <Plus aria-hidden="true" />
            </Button>
          </div>
        </>
      ) : null}
    </section>
  );
}

function projectedRepairGroups(
  repairs: RouteRepair[],
  positions: Array<{ id: string; x: number; y: number }>,
) {
  const groups: Array<{ repairs: RouteRepair[]; x: number; y: number }> = [];
  for (const repair of repairs) {
    const position = positions.find(({ id }) => id === repair.id);
    if (!position) continue;
    const group = groups.find(
      (candidate) => Math.hypot(candidate.x - position.x, candidate.y - position.y) < 44,
    );
    if (!group) {
      groups.push({ repairs: [repair], x: position.x, y: position.y });
      continue;
    }
    const count = group.repairs.length;
    group.x = (group.x * count + position.x) / (count + 1);
    group.y = (group.y * count + position.y) / (count + 1);
    group.repairs.push(repair);
  }
  return groups;
}
