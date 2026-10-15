import { useState } from "react";
import type { RouteSummary } from "@/domain/route";
import artwork from "@/data/route-covers/manifest.json";
import { RouteThread } from "@/ui/route-thread";

type Cover = { src: string; kind: string; width: number; height: number; points: string };
const covers = artwork as Record<string, Cover>;

/** Artwork is illustrative; the overlay is projected from recorded points, never AI output. */
export function RouteCover({ route }: { route: RouteSummary }) {
  const cover = covers[route.slug];
  const [failed, setFailed] = useState(false);
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
      <span className="route-cover-credit">{enhanced ? "Based on Esri imagery" : "Esri · World Imagery"}</span>
    </div>
  );
}
