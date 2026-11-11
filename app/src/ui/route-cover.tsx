import { useState } from "react";
import type { RouteSummary } from "@/domain/route";
import { loadRouteCoverArtwork, useRouteCoverArtwork } from "@/data/route-covers/route-cover-artwork";
import { RouteThread } from "@/ui/route-thread";

// Start the artwork request as soon as a surface that shows covers is loaded,
// in parallel with its first render rather than after it.
void loadRouteCoverArtwork();

/** Artwork is illustrative; the overlay is projected from recorded points, never AI output. */
export function RouteCover({ route, showCredit = true }: { route: RouteSummary; showCredit?: boolean }) {
  const artwork = useRouteCoverArtwork();
  const [failed, setFailed] = useState(false);
  // Reserve the cover's box while the artwork manifest loads, so cards never shift.
  // `.route-cover` always holds artwork; the placeholder only borrows the fallback's box.
  if (artwork.status === "loading") return <div className="route-cover-fallback" data-cover-kind="loading" aria-hidden="true" />;
  const cover = artwork.status === "ready" ? artwork.covers[route.slug] : undefined;
  if (!cover || failed) return <RouteThread route={route} className="route-cover-fallback" />;
  const enhanced = cover.kind === "ai-enhanced";
  return (
    <div className="route-cover" data-cover-kind={cover.kind}>
      <img className="route-cover-backdrop" src={cover.src} alt="" aria-hidden="true" loading="lazy" decoding="async" />
      <svg viewBox={`0 0 ${cover.width} ${cover.height}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true" className="route-cover-art">
        <polyline points={cover.points} fill="none" stroke="#10201c" strokeOpacity="0.65" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        <polyline points={cover.points} fill="none" stroke="#fff9e9" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <img className="route-cover-image" src={cover.src} alt={`${route.name}: ${enhanced ? "aerial artwork" : "satellite preview"} with recorded route trace`} loading="lazy" decoding="async" onError={() => setFailed(true)} />
      <span className="route-cover-shade" aria-hidden="true" />
      {showCredit ? <span className="route-cover-credit">{enhanced ? "Based on Esri imagery" : "Esri · World Imagery"}</span> : null}
    </div>
  );
}
