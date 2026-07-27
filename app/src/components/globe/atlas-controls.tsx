import { LocateFixed, Minus, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type AtlasActivityMode = "all" | "runs" | "rides";

interface AtlasControlsProps {
  selectedRegion: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetView: () => void;
}

export function AtlasControls({
  selectedRegion,
  onZoomIn,
  onZoomOut,
  onResetView,
}: AtlasControlsProps) {
  return (
    <div
      className={cn(
        "absolute right-3 z-20 flex border border-white/20 bg-[#02070a]/72 p-1 text-white backdrop-blur-md sm:right-5",
        selectedRegion
          ? "bottom-[23.5rem] [@media(max-height:620px)]:hidden"
          : "bottom-5",
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Reset globe view"
        title="Reset view"
        onClick={onResetView}
        className="size-10 rounded-sm text-white/72 hover:bg-white/10 hover:text-white"
      >
        <LocateFixed aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Zoom out"
        title="Zoom out"
        onClick={onZoomOut}
        className="size-10 rounded-sm text-white/72 hover:bg-white/10 hover:text-white"
      >
        <Minus aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Zoom in"
        title="Zoom in"
        onClick={onZoomIn}
        className="size-10 rounded-sm text-white/72 hover:bg-white/10 hover:text-white"
      >
        <Plus aria-hidden="true" />
      </Button>
    </div>
  );
}
