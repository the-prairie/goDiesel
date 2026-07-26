import { Map } from "lucide-react";

import type { RouteRegion } from "@/data/route-regions";

interface AtlasControlsProps {
  regions: RouteRegion[];
  selectedRegion?: RouteRegion;
  onSelectRegion: (region: RouteRegion) => void;
}

export function AtlasControls({
  regions,
  selectedRegion,
  onSelectRegion,
}: AtlasControlsProps) {
  return (
    <div className="absolute bottom-[calc(var(--mobile-navigation-height)+0.75rem)] left-[var(--mobile-edge)] z-[var(--z-map-controls)] flex max-w-[calc(100%-2rem)] items-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface/94 p-2 shadow-[var(--shadow-panel)] backdrop-blur-sm md:bottom-[var(--space-map-edge)] md:left-[var(--space-map-edge)]">
      <Map className="ml-1 size-4 shrink-0 text-route" aria-hidden="true" />
      <label className="sr-only" htmlFor="atlas-region-select">
        Browse route regions
      </label>
      <select
        id="atlas-region-select"
        aria-label="Browse route regions"
        value={selectedRegion?.name ?? ""}
        onChange={(event) => {
          const region = regions.find((candidate) => candidate.name === event.target.value);
          if (region) onSelectRegion(region);
        }}
        className="min-h-11 min-w-0 max-w-60 rounded-[var(--radius-control)] border border-line bg-surface-raised px-3 text-control text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <option value="" disabled>
          Browse regions
        </option>
        {regions.map((region) => (
          <option key={region.name} value={region.name}>
            {region.name}
          </option>
        ))}
      </select>
    </div>
  );
}
