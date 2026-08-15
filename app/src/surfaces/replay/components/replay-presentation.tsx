import { Eye, MapPinned, Navigation, Sparkles } from "lucide-react";

import type { GoogleRouteCameraMode } from "@/surfaces/replay/playback/route-navigator-controller";
import { cn } from "@/ui/utils";

export const REPLAY_CAMERA_MODES: Array<{
  mode: GoogleRouteCameraMode;
  label: string;
  icon: typeof Navigation;
}> = [
  { mode: "auto", label: "Auto director", icon: Sparkles },
  { mode: "runner", label: "Runner", icon: Navigation },
  { mode: "chase", label: "Chase", icon: Eye },
  { mode: "overview", label: "Overview", icon: MapPinned },
];

export function ReplayCameraControls({
  active,
  disabled,
  onSelect,
  tone = "intelligence",
}: {
  active: GoogleRouteCameraMode;
  disabled: boolean;
  onSelect: (mode: GoogleRouteCameraMode) => void;
  tone?: "intelligence" | "story";
}) {
  return (
    <div
      aria-label="Camera perspective"
      className={cn(
        "flex p-0.5",
        tone === "story"
          ? "border border-[#9ca8bf] bg-white/35"
          : "border border-white/15 bg-black/25",
      )}
      role="group"
    >
      {REPLAY_CAMERA_MODES.map(({ mode, label, icon: Icon }) => (
        <button
          aria-label={label}
          aria-pressed={active === mode}
          className={cn(
            "grid size-11 place-items-center",
            tone === "story"
              ? "text-[#60708e] hover:bg-white hover:text-[#1d2946]"
              : "text-white/55 hover:bg-white/10 hover:text-white",
            active === mode &&
              (tone === "story"
                ? "bg-white text-[#1d2946]"
                : "bg-white text-black hover:bg-white hover:text-black"),
          )}
          disabled={disabled}
          key={mode}
          onClick={() => onSelect(mode)}
          title={`${label} camera`}
          type="button"
        >
          <Icon aria-hidden="true" className="size-3.5" />
        </button>
      ))}
    </div>
  );
}

export function formatReplayDuration(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(safeSeconds / 3_600);
  const minutes = Math.floor((safeSeconds % 3_600) / 60);
  const seconds = safeSeconds % 60;
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
        .toString()
        .padStart(2, "0")}`
    : `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function formatReplayPace(
  paceSPerKm: number | undefined,
  activityType: string,
) {
  if (paceSPerKm === undefined || !Number.isFinite(paceSPerKm)) return "--";
  if (activityType.toLowerCase().includes("ride")) {
    return `${(3_600 / paceSPerKm).toFixed(1)} km/h`;
  }
  return `${formatReplayDuration(paceSPerKm)} /km`;
}
