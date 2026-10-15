import { LocateFixed, Minus, Plus } from "lucide-react";
import { Button } from "@/ui/button";

export type AtlasActivityMode = "all" | "runs" | "rides";

export function AtlasActivityFilter({
  mode,
  onModeChange,
}: {
  mode: AtlasActivityMode;
  onModeChange: (mode: AtlasActivityMode) => void;
}) {
  return (
    <div
      className="atlas-activity ember-segments"
      role="group"
      aria-label="Activity filter"
    >
      {(["all", "runs", "rides"] as const).map((value) => (
        <Button
          key={value}
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Show ${value === "all" ? "all activities" : value}`}
          aria-pressed={mode === value}
          onClick={() => onModeChange(value)}
          className="min-w-16"
        >
          {value === "all" ? "All" : value === "runs" ? "Runs" : "Rides"}
        </Button>
      ))}
    </div>
  );
}

export function AtlasControls({
  onZoomIn,
  onZoomOut,
  onResetView,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetView: () => void;
}) {
  return (
    <div
      className="atlas-map-tools absolute bottom-6 right-3 z-20 flex flex-col rounded-xl border border-line bg-surface/95 p-1 text-ink shadow-panel md:right-5"
      role="group"
      aria-label="Map controls"
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Reset globe view"
        onClick={onResetView}
      >
        <LocateFixed aria-hidden="true" />
      </Button>
      <div className="mx-2 border-t border-line" />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Zoom in"
        onClick={onZoomIn}
      >
        <Plus aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Zoom out"
        onClick={onZoomOut}
      >
        <Minus aria-hidden="true" />
      </Button>
    </div>
  );
}
