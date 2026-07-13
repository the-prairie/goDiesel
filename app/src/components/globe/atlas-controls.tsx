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
    <div className="absolute bottom-3 left-3 z-20 flex max-w-[calc(100%-1.5rem)] items-center gap-2 rounded-md border border-border bg-background/90 p-2 shadow-2xl backdrop-blur sm:bottom-4 sm:left-4">
      <Map className="ml-1 size-4 shrink-0 text-primary" aria-hidden="true" />
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
        className="min-h-9 min-w-0 max-w-60 rounded-sm border border-border bg-card px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
