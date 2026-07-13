import { ArrowRight, X } from "lucide-react";

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
  if (!selectedRegion) return null;

  return (
    <aside className="absolute inset-x-3 bottom-20 z-30 flex max-h-[44dvh] flex-col overflow-hidden rounded-md border border-border bg-background/94 shadow-2xl backdrop-blur sm:inset-x-auto sm:right-5 sm:top-[18.5rem] sm:w-[360px] sm:max-h-none xl:bottom-auto xl:right-4 xl:top-48 xl:max-h-[calc(100dvh-16rem)]">
      <div className="flex items-start justify-between gap-3 border-b border-border p-4">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase text-primary">
            Selected region
          </div>
          <h2 className="mt-1 truncate text-lg font-bold">{selectedRegion.name}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {selectedRegion.routes.length} routes · {selectedRegion.totalKm.toFixed(0)} km ·{" "}
            {Math.round(selectedRegion.totalClimbM).toLocaleString()} m up
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Clear selected region"
          onClick={onClear}
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>
      <div className="grid min-h-0 flex-1 gap-px overflow-y-auto bg-border">
        {selectedRegion.routes.map((route) => (
          <button
            key={route.slug}
            type="button"
            onClick={() => onOpenRoute(route)}
            className="flex min-h-14 items-center justify-between gap-3 bg-card px-4 py-3 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{route.name}</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                {route.type} · {route.distanceKm.toFixed(1)} km ·{" "}
                {route.elevationGainM.toLocaleString()} m up
              </span>
            </span>
            <ArrowRight className="size-4 shrink-0 text-primary" aria-hidden="true" />
          </button>
        ))}
      </div>
    </aside>
  );
}
