import type { RouteRepair } from "@/domain/geometry/route-repairs";
import {
  routeRepairEvidence,
  routeRepairSourceLabel,
} from "@/domain/geometry/route-repairs";
import { cn } from "@/ui/utils";

export function RepairEvidence({
  repairs,
  className,
}: {
  repairs: RouteRepair[];
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-label="Recorded repair evidence"
      className={cn(
        "border border-repair/60 bg-surface/96 px-3 py-2 text-caption text-ink-secondary shadow-panel backdrop-blur",
        className,
      )}
    >
      <p className="font-semibold text-ink">
        {repairs.length === 1 ? "Recorded repair" : `${repairs.length} recorded repairs`}
      </p>
      {repairs.map((repair) => (
        <div key={repair.id} className="mt-1 border-t border-repair/30 pt-1 first:border-0">
          <p>{routeRepairSourceLabel(repair)}</p>
          <p>{routeRepairEvidence(repair)}</p>
        </div>
      ))}
      <p className="mt-1 text-ink-muted">No route geometry was inferred.</p>
    </div>
  );
}
