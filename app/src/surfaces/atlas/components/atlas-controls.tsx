import { LocateFixed, Map, Minus, Plus } from "lucide-react";

import { Button } from "@/ui/button";
import type { RouteRegion } from "@/data/route-regions";
import { cn } from "@/ui/utils";

export type AtlasActivityMode = "all" | "runs" | "rides";

interface AtlasControlsProps {
  regions: RouteRegion[];
  selectedRegion?: RouteRegion;
  onSelectRegion: (region: RouteRegion) => void;
  mode: AtlasActivityMode;
  onModeChange: (mode: AtlasActivityMode) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetView: () => void;
}

export function AtlasControls({
  regions,
  selectedRegion,
  onSelectRegion,
  mode,
  onModeChange,
  onZoomIn,
  onZoomOut,
  onResetView,
}: AtlasControlsProps) {
  return (
    <>
      <div className={cn(
        "atlas-region-select absolute left-3 top-3 z-20 flex h-[54px] items-center gap-2 rounded-sm border border-white/45 bg-[#f6f2e8]/94 p-1 text-[#24322d] shadow-lg backdrop-blur sm:left-4 sm:top-4 md:left-5 md:top-[5.25rem] xl:left-[12.25rem] xl:top-5 xl:w-[220px]",
        selectedRegion && "[@media(max-height:600px)]:hidden",
      )}>
        <Map className="ml-1 size-4 shrink-0 text-[#315fb4]" aria-hidden="true" />
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
          className="min-h-11 min-w-0 max-w-24 rounded-sm border border-[#c7c1b5] bg-[#fffdf8] px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[#315fb4] [@media(min-width:380px)]:max-w-36 sm:max-w-52 sm:px-3 xl:min-w-0 xl:flex-1"
        >
          <option value="" disabled>
            Regions
          </option>
          {regions.map((region) => (
            <option key={region.name} value={region.name}>
              {region.name}
            </option>
          ))}
        </select>
      </div>

      <div className={cn(
        "atlas-mobile-activity absolute right-3 top-3 z-20 flex rounded-sm border border-white/35 bg-[#f6f2e8]/92 p-1 shadow-lg backdrop-blur sm:hidden",
        selectedRegion && "[@media(max-height:600px)]:hidden",
      )} aria-label="Activity filter">
        {(["all", "runs", "rides"] as const).map((value) => (
          <Button
            key={value}
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Show ${value === "all" ? "all activities" : value}`}
            aria-pressed={mode === value}
            onClick={() => onModeChange(value)}
            className="size-11 rounded-sm px-1 text-xs text-[#3b463f] aria-pressed:bg-[#314b32] aria-pressed:text-white"
          >
            {value === "all" ? "All" : value === "runs" ? "Run" : "Ride"}
          </Button>
        ))}
      </div>

      <div className={cn(
        "atlas-desktop-activity absolute left-[48.25rem] top-5 z-20 hidden h-[54px] rounded-sm border border-white/45 bg-[#f6f2e8]/94 p-1 shadow-lg backdrop-blur xl:flex",
        selectedRegion && "[@media(max-height:600px)]:hidden",
      )} aria-label="Activity filter">
        {(["all", "runs", "rides"] as const).map((value) => (
          <Button
            key={value}
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Show ${value === "all" ? "all activities" : value}`}
            aria-pressed={mode === value}
            onClick={() => onModeChange(value)}
            className="min-w-14 rounded-sm text-[#3b463f] aria-pressed:bg-[#314b32] aria-pressed:text-white"
          >
            {value[0].toUpperCase() + value.slice(1)}
          </Button>
        ))}
      </div>

      <div className={cn(
        "atlas-mobile-activity absolute right-4 top-4 z-20 hidden h-[54px] rounded-sm border border-white/45 bg-[#f6f2e8]/94 p-1 shadow-lg backdrop-blur sm:flex md:left-1/2 md:right-auto md:top-5 md:-translate-x-1/2 xl:hidden",
        selectedRegion && "[@media(max-height:600px)]:hidden",
      )} aria-label="Activity filter">
        {(["all", "runs", "rides"] as const).map((value) => (
          <Button
            key={value}
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Show ${value === "all" ? "all activities" : value}`}
            aria-pressed={mode === value}
            onClick={() => onModeChange(value)}
            className="min-w-12 rounded-sm px-2 text-[#3b463f] aria-pressed:bg-[#314b32] aria-pressed:text-white"
          >
            {value[0].toUpperCase() + value.slice(1)}
          </Button>
        ))}
      </div>

      <div
        className={cn(
          "atlas-mobile-map-tools absolute right-3 top-[9.75rem] z-40 flex gap-1 rounded-sm border border-white/35 bg-[#f6f2e8]/92 p-1 shadow-lg backdrop-blur md:left-5 md:right-auto md:top-auto",
          selectedRegion
            ? "md:bottom-[23rem] [@media(max-height:600px)]:hidden"
            : "md:bottom-5",
        )}
      >
        <Button type="button" variant="ghost" size="icon" aria-label="Reset globe view" onClick={onResetView} className="text-[#24322d]"><LocateFixed aria-hidden="true" /></Button>
        <Button type="button" variant="ghost" size="icon" aria-label="Zoom out" onClick={onZoomOut} className="text-[#24322d]"><Minus aria-hidden="true" /></Button>
        <Button type="button" variant="ghost" size="icon" aria-label="Zoom in" onClick={onZoomIn} className="text-[#24322d]"><Plus aria-hidden="true" /></Button>
      </div>
    </>
  );
}
