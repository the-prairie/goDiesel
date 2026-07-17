import { ArrowRight, ChevronDown, ChevronUp, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import type { RouteRegion } from "@/data/route-regions";
import type { RouteSummary } from "@/domain/routes";

interface RegionInspectorProps {
  selectedRegion?: RouteRegion;
  onClear: () => void;
  onOpenRoute: (route: RouteSummary) => void;
}

export function RegionInspector({
  selectedRegion,
  onClear,
  onOpenRoute,
}: RegionInspectorProps) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => setCollapsed(false), [selectedRegion?.name]);

  if (!selectedRegion) return null;

  return (
    <aside
      aria-label={`${selectedRegion.name} region guide`}
      data-collapsed={collapsed}
      className="atlas-region-inspector absolute inset-x-3 bottom-20 z-30 flex max-h-[44dvh] flex-col overflow-hidden rounded-sm border border-[#c7c1b5] bg-[#f6f2e8]/96 text-[#24322d] shadow-xl backdrop-blur xl:inset-x-auto xl:right-5 xl:top-20 xl:w-[360px] xl:max-h-[calc(100dvh-7rem)]"
    >
      <div className="flex items-start justify-between gap-3 border-b border-[#d4cec2] p-4">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase text-[#315fb4]">Field atlas</div>
          <h2 className="mt-1 font-editorial text-3xl font-semibold uppercase">{selectedRegion.name}</h2>
          <p className="mt-2 text-xs text-[#626a64]">
            {selectedRegion.routes.length} routes · {selectedRegion.totalKm.toFixed(0)} km ·{" "}
            {Math.round(selectedRegion.totalClimbM).toLocaleString()} m up
          </p>
        </div>
        <div className="flex gap-1">
          <Button type="button" variant="ghost" size="icon" aria-label={collapsed ? "Expand region guide" : "Collapse region guide"} onClick={() => setCollapsed((value) => !value)} className="text-[#24322d]">
            {collapsed ? <ChevronDown aria-hidden="true" /> : <ChevronUp aria-hidden="true" />}
          </Button>
          <Button type="button" variant="ghost" size="icon" aria-label="Clear selected region" onClick={onClear} className="text-[#24322d]"><X aria-hidden="true" /></Button>
        </div>
      </div>
      <ul hidden={collapsed} className="grid min-h-0 flex-1 divide-y divide-[#d4cec2] overflow-y-auto">
        {selectedRegion.routes.map((route) => (
          <li key={route.slug}>
            <button type="button" onClick={() => onOpenRoute(route)} className="flex min-h-16 w-full items-center justify-between gap-3 bg-transparent px-4 py-3 text-left outline-none transition-colors hover:bg-[#e9e5dc] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#315fb4]">
              <span className="min-w-0">
                <span className="block truncate font-editorial text-lg font-semibold">{route.name}</span>
                <span className="mt-1 block text-xs text-[#626a64]">{route.type} · {route.distanceKm.toFixed(1)} km · {route.elevationGainM.toLocaleString()} m up</span>
                {route.guide.reviewStatus !== "draft" && route.guide.vibe ? (
                  <span className="mt-2 block text-xs leading-5 text-[#4e584f]"><b className="font-semibold text-[#315fb4]">Reviewed field note</b> · {route.guide.vibe}</span>
                ) : null}
              </span>
              <ArrowRight className="size-4 shrink-0 text-[#315fb4]" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
