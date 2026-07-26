import { ArrowRight } from "lucide-react";

import {
  Margin,
  MarginEyebrow,
  MarginLedger,
  MarginNote,
  MarginSection,
} from "@/components/margin";
import type { RouteRegion } from "@/data/route-regions";
import type { RouteSummary } from "@/domain/routes";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

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
  const isMobile = useIsMobile();

  if (!selectedRegion) return null;

  return (
    <div
      className={cn(
        "atlas-region-inspector absolute z-[var(--z-inspector)]",
        isMobile
          ? "inset-x-3 bottom-[calc(var(--mobile-navigation-height)+0.75rem)] max-h-[48dvh]"
          : "bottom-auto right-[var(--space-map-edge)] top-24 w-[min(var(--margin-width),calc(100%-2rem))] max-h-[calc(100dvh-8rem)]",
      )}
    >
      <Margin
        presentation={isMobile ? "fold" : "column"}
        aria-label={`${selectedRegion.name} region`}
        onClose={onClear}
        closeLabel="Clear selected region"
        className={cn(
          "max-h-[inherit]",
          isMobile ? "w-full" : "h-full shadow-[var(--shadow-panel)]",
        )}
      >
        <MarginSection delayMs={40}>
          <MarginEyebrow>Selected region</MarginEyebrow>
          <h2 className="font-editorial text-place-mobile uppercase tracking-[0.16em] text-ink">
            {selectedRegion.name}
          </h2>
          <MarginNote>
            {selectedRegion.routes.length} routes inked across this ground —
            denser strokes where you return often.
          </MarginNote>
          <MarginLedger
            items={[
              {
                label: "Distance",
                value: `${selectedRegion.totalKm.toFixed(0)} km`,
              },
              {
                label: "Climb",
                value: `${Math.round(selectedRegion.totalClimbM).toLocaleString()} m`,
              },
              {
                label: "Routes",
                value: String(selectedRegion.routes.length),
              },
            ]}
          />
        </MarginSection>

        <MarginSection delayMs={120} className="gap-0">
          <MarginEyebrow>In the margin</MarginEyebrow>
          <ul className="mt-2 divide-y divide-line">
            {selectedRegion.routes.map((route) => (
              <li key={route.slug}>
                <button
                  type="button"
                  onClick={() => onOpenRoute(route)}
                  className="flex min-h-14 w-full items-center justify-between gap-3 py-3 text-left outline-none transition-colors hover:text-forest focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <span className="min-w-0">
                    <span className="font-editorial block truncate text-base font-medium tracking-[0.01em]">
                      {route.name}
                    </span>
                    <span className="mt-1 block font-tabular text-caption text-ink-muted">
                      {route.type} · {route.distanceKm.toFixed(1)} km ·{" "}
                      {route.elevationGainM.toLocaleString()} m up
                    </span>
                  </span>
                  <ArrowRight
                    className="size-4 shrink-0 text-route"
                    aria-hidden="true"
                  />
                </button>
              </li>
            ))}
          </ul>
        </MarginSection>
      </Margin>
    </div>
  );
}
