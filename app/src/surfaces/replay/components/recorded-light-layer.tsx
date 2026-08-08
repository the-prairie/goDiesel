import { Moon, SunMedium } from "lucide-react";

import type { RecordedLight } from "@/domain/recorded-light";
import { cn } from "@/ui/utils";

const phaseTreatment: Record<RecordedLight["phase"], string> = {
  neutral: "bg-transparent",
  dawn: "bg-[#efb784]/14 mix-blend-soft-light",
  midday: "bg-[#fff7df]/5 mix-blend-soft-light",
  dusk: "bg-[#d87d58]/18 mix-blend-multiply",
  night: "bg-[#10233f]/32 mix-blend-multiply",
};

export function RecordedLightLayer({
  light,
  reducedMotion,
}: {
  light: RecordedLight;
  reducedMotion: boolean;
}) {
  return (
    <div
      data-testid="recorded-light"
      data-light-phase={light.phase}
      data-motion={reducedMotion ? "static" : "route-synced"}
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 z-[1]",
        phaseTreatment[light.phase],
        !reducedMotion && "transition-colors duration-700",
      )}
    />
  );
}

export function RecordedLightLabel({ light }: { light: RecordedLight }) {
  if (light.status !== "recorded") return null;
  return (
    <div className="flex items-center gap-1.5 text-caption text-ink-muted">
      {light.phase === "night" ? (
        <Moon className="size-3.5" aria-hidden="true" />
      ) : (
        <SunMedium className="size-3.5" aria-hidden="true" />
      )}
      <span className="capitalize">Recorded {light.phase}</span>
      <span aria-hidden="true">·</span>
      <span>{light.localTimeLabel}</span>
    </div>
  );
}
