import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

import { visibleAtlasLabels } from "@/surfaces/atlas/atlas-label-layout";
import { AtlasRegionalFallback } from "@/surfaces/atlas/components/atlas-regional-fallback";
import type {
  AtlasGlobeHandle,
  AtlasGlobeProps,
  AtlasWorldEngine,
  AtlasWorldStatus,
} from "@/surfaces/atlas/atlas-world";
import { createAtlasWorldEngine } from "@/surfaces/atlas/cesium-atlas-world-engine";
import { cn } from "@/ui/utils";

export const CesiumAtlasGlobe = forwardRef<
  AtlasGlobeHandle,
  AtlasGlobeProps
>(function CesiumAtlasGlobe(
  {
    regions,
    illuminationTimeIso,
    selectedRegion,
    selectedRoute,
    onSelectRegion,
    onSelectRoute,
    onStatusChange,
    onRegionPresentationReady,
    className,
  },
  forwardedRef,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const labelRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const engineRef = useRef<AtlasWorldEngine | undefined>(undefined);
  const readyEngineRef = useRef<AtlasWorldEngine | undefined>(undefined);
  const selectedRegionRef = useRef(selectedRegion);
  const selectedRouteRef = useRef(selectedRoute);
  const onSelectRouteRef = useRef(onSelectRoute);
  const [status, setStatus] = useState<AtlasWorldStatus>({
    state: "loading",
    message: "Opening the Atlas world.",
  });

  useImperativeHandle(forwardedRef, () => ({
    zoomIn: () => engineRef.current?.zoomIn(),
    zoomOut: () => engineRef.current?.zoomOut(),
    resetView: () => engineRef.current?.resetView(),
  }));

  selectedRegionRef.current = selectedRegion;
  selectedRouteRef.current = selectedRoute;
  onSelectRouteRef.current = onSelectRoute;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const engine = createAtlasWorldEngine();
    engineRef.current = engine;
    void engine
      .mount({
        container,
        regions,
        illuminationTimeIso,
        onSelectRoute: (route) => onSelectRouteRef.current?.(route),
        onStatus: (nextStatus) => {
          setStatus(nextStatus);
          onStatusChange?.(nextStatus);
          if (nextStatus.state === "region-loading") {
            onRegionPresentationReady?.(false);
          } else if (nextStatus.state === "region-ready") {
            onRegionPresentationReady?.(true);
          } else if (
            nextStatus.state === "ready"
          ) {
            onRegionPresentationReady?.(false);
          } else if (nextStatus.state === "region-fallback") {
            onRegionPresentationReady?.(true);
          } else if (nextStatus.state === "unavailable") {
            onRegionPresentationReady?.(Boolean(selectedRegionRef.current));
          }
        },
      })
      .then(() => {
        if (engineRef.current === engine) {
          readyEngineRef.current = engine;
          engine.setSelectedRegion(selectedRegionRef.current);
          engine.setSelectedRoute(selectedRouteRef.current);
        }
      });
    return () => {
      if (readyEngineRef.current === engine) readyEngineRef.current = undefined;
      engine.destroy();
      if (engineRef.current === engine) engineRef.current = undefined;
    };
  }, [illuminationTimeIso, onRegionPresentationReady, onStatusChange, regions]);

  useEffect(() => {
    readyEngineRef.current?.setSelectedRegion(selectedRegion);
  }, [selectedRegion]);

  useEffect(() => {
    readyEngineRef.current?.setSelectedRoute(selectedRoute);
  }, [selectedRoute]);

  useEffect(() => {
    const updateLabels = () => {
      const projections = engineRef.current?.projectRegions() ?? [];
      const projectionByName = new Map(
        projections.map((projection) => [projection.name, projection]),
      );
      const viewport = {
        width: containerRef.current?.clientWidth ?? 1,
        height: containerRef.current?.clientHeight ?? 1,
      };
      const visible = new Set(
        visibleAtlasLabels(
          regions.flatMap((region, index) => {
            const projection = projectionByName.get(region.name);
            const label = labelRefs.current[index];
            if (!projection || !label) return [];
            return [{
              ...projection,
              width: label.offsetWidth || 130,
              height: label.offsetHeight || 28,
              priority:
                (selectedRegion?.name === region.name ? 100 : 0) +
                region.routes.length,
              selected: selectedRegion?.name === region.name,
            }];
          }),
          viewport,
        ),
      );
      regions.forEach((region, index) => {
        const label = labelRefs.current[index];
        const projection = projectionByName.get(region.name);
        if (!label || !projection) return;
        label.style.left = `${projection.x}px`;
        label.style.top = `${projection.y}px`;
        label.style.display = visible.has(region.name) ? "flex" : "none";
        label.dataset.active = String(selectedRegion?.name === region.name);
      });
    };
    updateLabels();
    const interval = window.setInterval(updateLabels, 80);
    return () => window.clearInterval(interval);
  }, [regions, selectedRegion]);

  return (
    <div
      data-atlas-engine="cesium"
      data-atlas-status={status.state}
      data-atlas-state={status.state === "ready" ? "global" : status.state}
      data-terrain-state={
        status.state === "region-loading"
          ? "loading"
          : status.state === "region-ready"
            ? "ready"
            : status.state === "region-fallback"
              ? "fallback"
              : "global"
      }
      className={cn(
        "relative min-h-[520px] overflow-hidden rounded-none border-0 bg-[#02070a]",
        className,
      )}
    >
      <div
        ref={containerRef}
        className={cn(
          "absolute inset-0",
          status.state === "region-fallback" && "invisible",
        )}
      />
      {status.state === "region-fallback" && selectedRegion ? (
        <AtlasRegionalFallback
          region={selectedRegion}
          selectedRoute={selectedRoute}
          onSelectRoute={(route) => onSelectRouteRef.current?.(route)}
          onReady={() => onRegionPresentationReady?.(true)}
        />
      ) : null}
      <div
        className={cn(
          "pointer-events-none absolute inset-0",
          status.state !== "ready" && "hidden",
        )}
      >
        {regions.map((region, index) => (
          <button
            key={region.name}
            ref={(node) => {
              labelRefs.current[index] = node;
            }}
            type="button"
            data-globe-region={region.name}
            aria-label={`Select ${region.name} on globe`}
            onClick={() => onSelectRegion(region)}
            className="pointer-events-auto absolute hidden -translate-x-1/2 -translate-y-1/2 items-center gap-2 whitespace-nowrap rounded-sm border border-white/30 bg-[#f6f2e8]/90 px-3 py-1.5 text-[11px] font-semibold uppercase text-[#24322d] shadow-lg backdrop-blur transition-colors hover:border-[#315fb4] hover:text-[#183a76] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#315fb4] focus-visible:ring-offset-2 focus-visible:ring-offset-[#02070a] data-[active=true]:border-[#df674b] data-[active=true]:text-[#9b321f]"
          >
            <span className="size-1.5 rounded-full bg-[#df674b]" />
            {region.name} · {region.routes.length}
          </button>
        ))}
      </div>
      {status.state === "loading" || status.state === "region-loading" ? (
        <div
          role="status"
          aria-live="polite"
          data-region-loading={
            status.state === "region-loading" ? status.regionName : undefined
          }
          className="pointer-events-none absolute bottom-24 left-4 z-20 min-h-12 min-w-52 border border-white/25 bg-[#071019]/88 px-3 py-2 text-xs text-white shadow-lg xl:bottom-56 xl:left-[15.5rem]"
        >
          {status.message}
        </div>
      ) : null}
      {status.state === "unavailable" ? (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute bottom-24 left-4 z-20 max-w-sm border border-white/25 bg-[#f6f2e8]/96 px-3 py-2 text-xs text-[#24322d] shadow-lg xl:left-5"
        >
          {status.message} Search and navigation remain available.
        </div>
      ) : null}
    </div>
  );
});
