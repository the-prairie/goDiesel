import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

import type {
  AtlasGlobeHandle,
  AtlasGlobeProps,
  AtlasWorldEngine,
  AtlasWorldStatus,
} from "@/components/globe/atlas-world";
import { createAtlasWorldEngine } from "@/atlas/cesium-atlas-world-engine";
import { cn } from "@/lib/utils";

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
  const engineRef = useRef<AtlasWorldEngine | undefined>(undefined);
  const readyEngineRef = useRef<AtlasWorldEngine | undefined>(undefined);
  const selectedRegionRef = useRef(selectedRegion);
  const selectedRouteRef = useRef(selectedRoute);
  const onSelectRegionRef = useRef(onSelectRegion);
  const onSelectRouteRef = useRef(onSelectRoute);
  const onStatusChangeRef = useRef(onStatusChange);
  const onRegionPresentationReadyRef = useRef(onRegionPresentationReady);
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
  onSelectRegionRef.current = onSelectRegion;
  onSelectRouteRef.current = onSelectRoute;
  onStatusChangeRef.current = onStatusChange;
  onRegionPresentationReadyRef.current = onRegionPresentationReady;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const engine = createAtlasWorldEngine();
    engineRef.current = engine;
    void engine
      .mount({
        container,
        regions,
        onSelectRegion: (region) => onSelectRegionRef.current?.(region),
        onSelectRoute: (route) => onSelectRouteRef.current?.(route),
        onStatus: (nextStatus) => {
          setStatus(nextStatus);
          onStatusChangeRef.current?.(nextStatus);
          if (nextStatus.state === "region-loading") {
            onRegionPresentationReadyRef.current?.(false);
          } else if (nextStatus.state === "region-ready") {
            onRegionPresentationReadyRef.current?.(true);
          } else if (nextStatus.state === "region-fallback") {
            onRegionPresentationReadyRef.current?.(true);
          } else if (
            nextStatus.state === "ready"
          ) {
            onRegionPresentationReadyRef.current?.(false);
          } else if (nextStatus.state === "unavailable") {
            onRegionPresentationReadyRef.current?.(
              Boolean(selectedRegionRef.current),
            );
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
  }, [regions]);

  useEffect(() => {
    readyEngineRef.current?.setSelectedRegion(selectedRegion);
  }, [selectedRegion]);

  useEffect(() => {
    readyEngineRef.current?.setSelectedRoute(selectedRoute);
  }, [selectedRoute]);

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
        className="absolute inset-0"
      />
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
