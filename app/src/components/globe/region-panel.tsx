import { ArrowRight, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { RouteRegion } from "@/data/route-regions";
import type { RouteSummary } from "@/domain/routes";
import { cn } from "@/lib/utils";

interface RegionPanelProps {
  regions: RouteRegion[];
  selectedRegion?: RouteRegion;
  onSelectRegion: (region: RouteRegion | undefined) => void;
  onOpenRoute: (route: RouteSummary) => void;
}

export function RegionPanel({
  regions,
  selectedRegion,
  onSelectRegion,
  onOpenRoute,
}: RegionPanelProps) {
  const totalKm = regions.reduce((sum, region) => sum + region.totalKm, 0);
  const totalClimb = regions.reduce((sum, region) => sum + region.totalClimbM, 0);
  const activeRoutes = selectedRegion?.routes ?? [];

  return (
    <aside className="grid gap-4">
      <div className="rounded-md border border-border bg-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase text-primary">
              {selectedRegion ? "Selected region" : "Route regions"}
            </div>
            <h2 className="mt-2 text-xl font-bold">
              {selectedRegion?.name ?? "Completed atlas"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {selectedRegion
                ? `${selectedRegion.routes.length} routes · ${selectedRegion.totalKm.toFixed(0)} km · ${Math.round(selectedRegion.totalClimbM).toLocaleString()} m up`
                : `${regions.length} regions · ${totalKm.toFixed(0)} km · ${Math.round(totalClimb).toLocaleString()} m up`}
            </p>
          </div>
          {selectedRegion ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Clear selected region"
              onClick={() => onSelectRegion(undefined)}
            >
              <RotateCcw className="size-4" aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </div>

      {selectedRegion ? (
        <div className="grid max-h-[420px] gap-2 overflow-y-auto pr-1">
          {activeRoutes.map((route) => (
            <button
              key={route.slug}
              type="button"
              onClick={() => onOpenRoute(route)}
              className="rounded-md border border-border bg-card px-4 py-3 text-left outline-none transition-colors hover:border-primary/60 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-semibold">{route.name}</div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {route.type} · {route.distanceKm.toFixed(1)} km ·{" "}
                    {route.elevationGainM.toLocaleString()} m up
                  </div>
                </div>
                <ArrowRight className="size-4 text-primary" aria-hidden="true" />
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="grid max-h-[420px] gap-2 overflow-y-auto pr-1">
          {regions.slice(0, 12).map((region) => (
            <button
              key={region.name}
              type="button"
              onClick={() => onSelectRegion(region)}
              className={cn(
                "rounded-md border border-border bg-card px-4 py-3 text-left outline-none transition-colors hover:border-primary/60 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <div className="font-semibold">{region.name}</div>
              <div className="mt-1 text-sm text-muted-foreground">
                {region.routes.length} routes · {region.totalKm.toFixed(0)} km
              </div>
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
