import type { ExternalRoute } from "@/domain/search/external";
import {
  assessRoute,
  shapeLabels,
  shapeGuidance,
} from "@/domain/search/route-quality";
export function ExternalRouteEvidence({ route }: { route: ExternalRoute }) {
  const quality = assessRoute(route);
  const coverage = route.surfaceCoverage ?? (route.surface ? 1 : 0);
  const surfaces = route.surface
    ? `Surface: ${route.surface}`
    : coverage > 0
      ? `${coverage >= 0.999999 ? "Mixed surfaces" : `Surface partly mapped (${Math.min(99, Math.round(coverage * 100))}%)`}: ${[...new Set(route.surfaces?.flatMap((s) => s.split(";")))].join(", ")}`
      : "Surface unknown";
  return (
    <div className="mt-3 border-t border-line pt-3 text-sm text-ink-secondary">
      <p className="font-medium text-ink">
        {shapeLabels[quality.shape]}
        {quality.components > 1 ? ` · ${quality.components} sections` : ""}
      </p>
      {quality.shape === "disconnected" || quality.shape === "branched" ? (
        <p className="mt-1">{shapeGuidance[quality.shape]}</p>
      ) : null}
      {quality.distanceMismatch ? (
        <p className="mt-2">
          Source distance {route.distanceKm.toFixed(1)} km; mapped paths{" "}
          {quality.mappedKm.toFixed(1)} km. Check the source itinerary.
        </p>
      ) : null}
      <details className="mt-1">
        <summary className="cursor-pointer py-2 text-xs underline underline-offset-4 focus-visible:outline">
          Path and surface details
        </summary>
        {quality.shape === "loop" || quality.shape === "open" ? (
          <p className="mt-1">{shapeGuidance[quality.shape]}</p>
        ) : null}
        <p className="mt-2">{surfaces}</p>
        <p className="mt-1 text-xs text-ink-muted">
          {route.surfaceEvidence === "all-ways"
            ? "All mapped ways have surface tags. "
            : ""}
          {route.ascentM == null
            ? "Climb unknown."
            : "Climb is source-tagged, not a terrain measurement."}{" "}
          Connectivity is based on map geometry; current access is not verified.
        </p>
      </details>
    </div>
  );
}
