import { AlertTriangle, CheckCircle2, CircleDashed, Database, Map, Play } from "lucide-react";

import type {
  AdminRouteRecord,
  CurationValidation,
} from "@/domain/admin-curation";

export function CurationStatus({
  route,
  validation,
}: {
  route: AdminRouteRecord;
  validation: CurationValidation;
}) {
  const ValidationIcon = validation.state === "invalid" ? AlertTriangle : validation.missingFields.length > 0 ? CircleDashed : CheckCircle2;

  return (
    <section aria-label="Route readiness" className="grid gap-4 border-y border-border py-4">
      <div className="grid gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-3">
        <StatusMetric
          icon={Map}
          label="Geometry"
          value={route.geometryStatus}
          healthy={route.geometryStatus === "ready"}
        />
        <StatusMetric
          icon={Play}
          label="Replay"
          value={route.replayEligible ? "Eligible" : "Unavailable"}
          healthy={route.replayEligible}
        />
        <StatusMetric
          icon={Database}
          label="Generation"
          value={route.generationStatus}
          healthy={route.generationStatus === "ready"}
        />
      </div>

      <div
        role="status"
        className={validation.state === "invalid" ? "flex gap-3 text-sm text-destructive" : "flex gap-3 text-sm text-muted-foreground"}
      >
        <ValidationIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div className="grid gap-1">
          <p>{validation.message}</p>
          {validation.missingFields.length > 0 ? (
            <p className="text-xs">Missing: {validation.missingFields.map(humanize).join(", ")}</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function StatusMetric({
  icon: Icon,
  label,
  value,
  healthy,
}: {
  icon: typeof Map;
  label: string;
  value: string;
  healthy: boolean;
}) {
  return (
    <div className="grid gap-2 bg-card p-3">
      <dt className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-3.5" aria-hidden="true" />
        {label}
      </dt>
      <dd className={healthy ? "text-sm font-medium capitalize text-primary" : "text-sm font-medium capitalize text-foreground"}>
        {value}
      </dd>
    </div>
  );
}

function humanize(value: string) {
  return value.replace(/([A-Z])/g, " $1").toLowerCase();
}
