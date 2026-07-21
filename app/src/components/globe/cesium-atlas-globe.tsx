import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

import { visibleAtlasLabels } from "@/components/globe/atlas-label-layout";
import type {
  AtlasGlobeHandle,
  AtlasGlobeProps,
  AtlasWorldEngine,
  AtlasWorldStatus,
} from "@/components/globe/atlas-world";
import { createAtlasWorldEngine } from "@/atlas/cesium-atlas-world-engine";
import { cn } from "@/lib/utils";

interface CesiumAtlasGlobeProps extends AtlasGlobeProps {
  onUnavailable: (message: string) => void;
}

export const CesiumAtlasGlobe = forwardRef<
  AtlasGlobeHandle,
  CesiumAtlasGlobeProps
>(function CesiumAtlasGlobe(
  { regions, selectedRegion, onSelectRegion, className, onUnavailable },
  forwardedRef,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const labelRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const engineRef = useRef<AtlasWorldEngine | undefined>(undefined);
  const selectedRegionRef = useRef(selectedRegion);
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

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const engine = createAtlasWorldEngine();
    engineRef.current = engine;
    void engine
      .mount({
        container,
        regions,
        onStatus: (nextStatus) => {
          setStatus(nextStatus);
          if (nextStatus.state === "unavailable") {
            onUnavailable(nextStatus.message);
          }
        },
      })
      .then(() => {
        if (engineRef.current === engine) {
          engine.setSelectedRegion(selectedRegionRef.current);
        }
      });
    return () => {
      engine.destroy();
      if (engineRef.current === engine) engineRef.current = undefined;
    };
  }, [onUnavailable, regions]);

  useEffect(() => {
    engineRef.current?.setSelectedRegion(selectedRegion);
  }, [selectedRegion]);

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
      className={cn(
        "relative min-h-[520px] overflow-hidden rounded-none border-0 bg-[#02070a]",
        className,
      )}
    >
      <div ref={containerRef} className="absolute inset-0" />
      <div className="pointer-events-none absolute inset-0">
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
      {status.state === "loading" ? (
        <div
          role="status"
          className="pointer-events-none absolute bottom-24 left-4 z-20 border border-white/25 bg-[#071019]/88 px-3 py-2 text-xs text-white shadow-lg xl:left-[15.5rem]"
        >
          {status.message}
        </div>
      ) : null}
    </div>
  );
});
