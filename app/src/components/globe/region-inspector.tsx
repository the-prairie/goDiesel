import { ArrowRight, ChevronDown, ChevronUp, Minus, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import type { RouteRegion } from "@/data/route-regions";
import type { RouteSummary } from "@/domain/routes";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

export type MobileSheetPosition = "peek" | "half" | "expanded";

interface RegionInspectorProps {
  selectedRegion?: RouteRegion;
  onClear: () => void;
  onOpenRoute: (route: RouteSummary) => void;
  mobilePosition: MobileSheetPosition;
  onMobilePositionChange: (position: MobileSheetPosition) => void;
}

export function RegionInspector({
  selectedRegion,
  onClear,
  onOpenRoute,
  mobilePosition,
  onMobilePositionChange,
}: RegionInspectorProps) {
  const [collapsed, setCollapsed] = useState(false);
  const isMobile = useIsMobile();

  useEffect(() => setCollapsed(false), [selectedRegion?.name]);

  if (!selectedRegion) return null;

  return (
    <aside
      aria-label={`${selectedRegion.name} region guide`}
      data-collapsed={collapsed}
      data-snap={isMobile ? mobilePosition : undefined}
      className={cn(
        "atlas-region-inspector absolute z-30 flex flex-col overflow-hidden rounded-t-sm border border-[#c7c1b5] bg-[#f6f2e8]/96 text-[#24322d] shadow-xl backdrop-blur transition-[height] duration-300",
        isMobile && mobilePosition === "peek" &&
          "inset-x-3 bottom-0 h-[8.5rem] max-h-none",
        isMobile && mobilePosition === "half" &&
          "inset-x-3 bottom-0 h-[46dvh] max-h-none",
        isMobile && mobilePosition === "expanded" &&
          "inset-x-3 bottom-0 h-[calc(100dvh-0.75rem)] max-h-none",
        !isMobile &&
          "inset-x-3 bottom-20 max-h-[44dvh] rounded-sm xl:inset-x-auto xl:right-5 xl:top-20 xl:w-[360px] xl:max-h-[calc(100dvh-7rem)]",
      )}
    >
      {isMobile ? (
        <div className={cn("flex items-center justify-center border-b border-[#d4cec2]", mobilePosition === "peek" ? "min-h-6" : "min-h-8")}>
          <span className="h-1 w-10 rounded-full bg-[#9f9a90]" aria-hidden="true" />
        </div>
      ) : null}
      <div className={cn("flex items-start justify-between gap-3 border-b border-[#d4cec2]", isMobile ? "p-3" : "p-4")}>
        <div className="min-w-0">
          <div className={cn("text-xs font-semibold uppercase text-[#315fb4]", isMobile && mobilePosition === "peek" && "hidden")}>Field atlas</div>
          <h2 className={cn("font-editorial font-semibold uppercase", isMobile ? "text-xl leading-6" : "mt-1 text-3xl")}>{selectedRegion.name}</h2>
          <p className={cn("text-xs text-[#626a64]", isMobile ? "mt-1" : "mt-2", isMobile && mobilePosition === "peek" && "hidden")}>
            {selectedRegion.routes.length} routes · {selectedRegion.totalKm.toFixed(0)} km ·{" "}
            {Math.round(selectedRegion.totalClimbM).toLocaleString()} m up
          </p>
        </div>
        <div className="flex gap-1">
          {isMobile ? (
            <>
              <Button type="button" variant="ghost" size="icon" aria-label="Set route sheet to peek" title="Peek" onClick={() => onMobilePositionChange("peek")} className="size-11 text-[#24322d]"><ChevronDown aria-hidden="true" /></Button>
              <Button type="button" variant="ghost" size="icon" aria-label="Set route sheet to half" title="Half" onClick={() => onMobilePositionChange("half")} className="size-11 text-[#24322d]"><Minus aria-hidden="true" /></Button>
              <Button type="button" variant="ghost" size="icon" aria-label="Set route sheet to expanded" title="Expanded" onClick={() => onMobilePositionChange("expanded")} className="size-11 text-[#24322d]"><ChevronUp aria-hidden="true" /></Button>
            </>
          ) : (
            <Button type="button" variant="ghost" size="icon" aria-label={collapsed ? "Expand region guide" : "Collapse region guide"} onClick={() => setCollapsed((value) => !value)} className="text-[#24322d]">
              {collapsed ? <ChevronDown aria-hidden="true" /> : <ChevronUp aria-hidden="true" />}
            </Button>
          )}
          <Button type="button" variant="ghost" size="icon" aria-label="Clear selected region" onClick={onClear} className="text-[#24322d]"><X aria-hidden="true" /></Button>
        </div>
      </div>
      <ul hidden={collapsed || (isMobile && mobilePosition === "peek")} className="grid min-h-0 flex-1 divide-y divide-[#d4cec2] overflow-y-auto">
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
