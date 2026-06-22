import { useState } from "react";

import { AtlasGlobe } from "@/components/globe/atlas-globe";
import { RegionPanel } from "@/components/globe/region-panel";
import { AtlasSearch } from "@/components/search/atlas-search";
import { completedRoutes } from "@/data/routes";
import { routeRegions, type RouteRegion } from "@/data/route-regions";
import type { QuestRoute } from "@/domain/routes";

interface AtlasPageProps {
  onOpenRoute: (route: QuestRoute) => void;
}

export function AtlasPage({ onOpenRoute }: AtlasPageProps) {
  const [selectedRegion, setSelectedRegion] = useState<RouteRegion | undefined>(
    routeRegions[0],
  );

  return (
    <section className="grid gap-5">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <div>
          <div className="text-xs font-semibold uppercase text-primary">
            Atlas
          </div>
          <h1 className="mt-3 max-w-3xl text-3xl font-bold sm:text-5xl">
            Real places, playable days.
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-muted-foreground">
            Explore completed runs and rides as route heat over a living globe.
            Search past memories, choose a region, then open the route in the
            existing replay flow.
          </p>
        </div>
        <AtlasSearch
          routes={completedRoutes}
          regions={routeRegions}
          onSelectRegion={setSelectedRegion}
          onOpenRoute={onOpenRoute}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <AtlasGlobe
          regions={routeRegions}
          selectedRegion={selectedRegion}
          onSelectRegion={setSelectedRegion}
          onOpenRoute={onOpenRoute}
        />
        <RegionPanel
          regions={routeRegions}
          selectedRegion={selectedRegion}
          onSelectRegion={setSelectedRegion}
          onOpenRoute={onOpenRoute}
        />
      </div>
    </section>
  );
}
