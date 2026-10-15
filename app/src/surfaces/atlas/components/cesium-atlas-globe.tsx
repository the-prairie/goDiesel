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
  }, [onRegionPresentationReady, onStatusChange, regions]);

  useEffect(() => {
    readyEngineRef.current?.setSelectedRegion(selectedRegion);
  }, [selectedRegion]);

  useEffect(() => {
    readyEngineRef.current?.setSelectedRoute(selectedRoute);
  }, [selectedRoute]);

  useEffect(() => {
    if (status.state !== "ready") return;
    let animationFrame = 0;
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
              width: label.offsetWidth,
              height: label.offsetHeight,
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
        // Keep rejected labels measurable. display:none makes the next pass
        // use an undersized box, repeatedly showing and hiding dense labels.
        label.style.visibility = visible.has(region.name) ? "visible" : "hidden";
        label.dataset.active = String(selectedRegion?.name === region.name);
      });
      animationFrame = window.requestAnimationFrame(updateLabels);
    };
    updateLabels();
    return () => window.cancelAnimationFrame(animationFrame);
  }, [regions, selectedRegion, status.state]);

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
            className="atlas-world-label invisible pointer-events-auto absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 whitespace-nowrap rounded-md border border-line bg-surface/95 px-2.5 py-2 text-xs font-medium text-ink shadow-lg transition-colors hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-[active=true]:border-primary"
          >
            <span className="size-1.5 rounded-full bg-ink" />
            {region.name}<span className="rounded bg-black/5 px-1.5 py-0.5 text-[10px] text-ink-secondary">{region.routes.length} {region.routes.length === 1 ? "route" : "routes"}</span>
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
          className="pointer-events-none absolute bottom-24 left-4 z-20 max-w-sm border border-white/25 bg-surface px-3 py-2 text-xs text-ink shadow-lg xl:left-5"
        >
          {status.message} Search and navigation remain available.
        </div>
      ) : null}
    </div>
  );
});
