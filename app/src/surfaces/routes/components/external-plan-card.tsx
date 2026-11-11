import { useState } from "react";
import { Button } from "@/ui/button";
import {
  externalPlanGpx,
  removeExternalPlan,
  type ExternalPlan,
} from "@/data/external-plan-store";
import { ExternalRouteEvidence } from "@/ui/external-route-evidence";
import { FinderRouteMap } from "@/ui/planning-route-map";
export function ExternalPlanCard({ plan }: { plan: ExternalPlan }) {
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState("");
  const r = plan.route;
  function download() {
    const url = URL.createObjectURL(
      new Blob([externalPlanGpx(r)], { type: "application/gpx+xml" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${r.id}-mapped-paths.gpx`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <article
      aria-label={`Planned discovery ${r.name}`}
      className="min-w-0 rounded-xl border border-line p-4"
    >
      <p className="text-xs text-ink-muted">
        Planned · OpenStreetMap · Saved on this device
      </p>
      <h2 className="mt-2 text-xl">{r.name}</h2>
      <p className="mt-1 text-sm text-ink-secondary">
        {plan.place} · {r.activity === "Run" ? "Walking / running" : "Cycling"}
      </p>
      <p className="mt-2 text-sm">
        {r.distanceKm.toFixed(1)} km{" "}
        {r.distanceKind === "mapped" ? "of mapped paths" : "source distance"} ·{" "}
        {r.ascentM == null ? "Climb unknown" : `${r.ascentM} m climb`}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Close preview" : "Preview plan"}
        </Button>
        <Button variant="ghost" size="sm" onClick={download}>
          Download mapped GPX
        </Button>
        <a
          href={r.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center px-2 text-sm underline"
        >
          View source
        </a>
      </div>
      {expanded ? (
        <>
          <div className="relative mt-3 h-72 overflow-hidden rounded-lg">
            <FinderRouteMap lines={r.lines} selectedSlug={r.id} />
          </div>
          <ExternalRouteEvidence route={r} />
          <p className="mt-2 text-xs text-ink-muted">
            GPX preserves separate mapped sections, with no invented connectors,
            timestamps or elevations. It is not a recorded activity.
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-3"
            onClick={() => {
              try {
                removeExternalPlan(r.id);
              } catch {
                setError(
                  "Could not remove this plan. Device storage is unavailable.",
                );
              }
            }}
          >
            Remove plan
          </Button>
        </>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </article>
  );
}
