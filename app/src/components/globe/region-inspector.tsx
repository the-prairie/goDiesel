import { ArrowRight, Check, ChevronDown, ChevronUp, Minus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import type { RouteRegion } from "@/data/route-regions";
import type { RouteSummary } from "@/domain/routes";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

export type MobileSheetPosition = "peek" | "half" | "expanded";

interface RegionInspectorProps {
  selectedRegion?: RouteRegion;
  selectedRoute?: RouteSummary;
  onClear: () => void;
  onSelectRoute: (route: RouteSummary) => void;
  replayPathForRoute: (route: RouteSummary) => string;
  mobilePosition: MobileSheetPosition;
  onMobilePositionChange: (position: MobileSheetPosition) => void;
}

export function RegionInspector({
  selectedRegion,
  selectedRoute,
  onClear,
  onSelectRoute,
  replayPathForRoute,
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
          "inset-x-3 bottom-0 top-3 h-auto max-h-none",
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
      <ul hidden={collapsed || (isMobile && mobilePosition === "peek")} className="min-h-0 flex-1 divide-y divide-[#d4cec2] overflow-y-auto">
        {selectedRegion.routes.map((route) => (
          <li key={route.slug} data-selected={selectedRoute?.slug === route.slug}>
            <div
              className="flex min-h-16 items-center gap-2 px-2 py-1 data-[selected=true]:bg-[#e9e5dc]"
              data-selected={selectedRoute?.slug === route.slug}
            >
              <button
                type="button"
                aria-label={`Select ${route.name}`}
                aria-pressed={selectedRoute?.slug === route.slug}
                onClick={() => onSelectRoute(route)}
                className="flex min-w-0 flex-1 items-center justify-between gap-3 bg-transparent px-2 py-2 text-left outline-none transition-colors hover:bg-[#e9e5dc] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#315fb4]"
              >
                <span className="min-w-0">
                  <span className="block truncate font-editorial text-lg font-semibold">{route.name}</span>
                  <span className="mt-1 block text-xs text-[#626a64]">{route.type} · {route.distanceKm.toFixed(1)} km · {route.elevationGainM.toLocaleString()} m up</span>
                  {route.guide.reviewStatus !== "draft" && route.guide.vibe ? (
                    <span className="mt-2 block text-xs leading-5 text-[#4e584f]"><b className="font-semibold text-[#315fb4]">Reviewed field note</b> · {route.guide.vibe}</span>
                  ) : null}
                </span>
                {selectedRoute?.slug === route.slug ? <Check className="size-4 shrink-0 text-[#315fb4]" aria-hidden="true" /> : <ArrowRight className="size-4 shrink-0 text-[#315fb4]" aria-hidden="true" />}
              </button>
              {selectedRoute?.slug === route.slug ? (
                <Button asChild size="sm" className="shrink-0 bg-[#183a76] text-white hover:bg-[#315fb4]">
                  <Link to={replayPathForRoute(route)} aria-label="Open replay">Open replay</Link>
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}
