import { useMemo, useState } from "react";

import type { RoutePoint, RouteSummary } from "@/domain/route";
import { cn } from "@/ui/utils";

const thumbnailWidth = 160;
const thumbnailHeight = 160;
const maximumPathPoints = 36;

type RouteThumbnailOutcome = "loaded" | "failed";
type RouteThumbnailState =
  | "deferred"
  | "loading"
  | RouteThumbnailOutcome
  | "unavailable";

declare global {
  interface Window {
    __GODIESEL_STATIC_MAPS_API_KEY__?: string;
  }
}

export function RouteSatelliteThumbnail({
  route,
  enabled,
}: {
  route: RouteSummary;
  enabled: boolean;
}) {
  const url = useMemo(
    () =>
      routeSatelliteThumbnailUrl(
        route.trace,
        window.__GODIESEL_STATIC_MAPS_API_KEY__ ||
          import.meta.env.VITE_GOOGLE_MAPS_API_KEY ||
          "",
      ),
    [route.trace],
  );
  // Only the image's own outcome is state. Cards are keyed by route slug, so
  // the URL is fixed for this component's lifetime.
  const [outcome, setOutcome] = useState<RouteThumbnailOutcome>();
  const state = routeThumbnailState(enabled, url, outcome);
  const requestImage =
    Boolean(url) && state !== "failed" && (enabled || state === "loaded");

  return (
    <div
      data-route-thumbnail={route.slug}
      data-thumbnail-state={state}
      className="pointer-events-none absolute inset-0 z-[1] overflow-hidden"
    >
      {requestImage ? (
        <img
          src={url!}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={() => setOutcome("loaded")}
          onError={() => setOutcome("failed")}
          className={cn(
            "size-full object-contain transition-opacity duration-200 motion-reduce:transition-none",
            state === "loaded" ? "opacity-100" : "opacity-0",
          )}
        />
      ) : null}
    </div>
  );
}

/** A loaded or failed image keeps its outcome when it leaves the request window. */
export function routeThumbnailState(
  enabled: boolean,
  url: string | null,
  outcome: RouteThumbnailOutcome | undefined,
): RouteThumbnailState {
  if (!url) return "unavailable";
  return outcome ?? (enabled ? "loading" : "deferred");
}

export function routeSatelliteThumbnailUrl(
  points: RoutePoint[],
  apiKey: string,
) {
  const path = downsampleThumbnailPath(points);
  if (!apiKey || path.length < 2) return null;

  const params = new URLSearchParams({
    size: `${thumbnailWidth}x${thumbnailHeight}`,
    scale: "2",
    maptype: "satellite",
    format: "png",
    path: `color:0xf5f5f5ff|weight:3|${path
      .map((point) => `${point.lat.toFixed(5)},${point.lng.toFixed(5)}`)
      .join("|")}`,
    key: apiKey,
  });

  return `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
}

export function downsampleThumbnailPath(points: RoutePoint[]) {
  const valid = points.filter(
    (point) =>
      Number.isFinite(point.lat) &&
      Number.isFinite(point.lng) &&
      point.lat >= -90 &&
      point.lat <= 90 &&
      point.lng >= -180 &&
      point.lng <= 180,
  );
  if (valid.length <= maximumPathPoints) return valid;

  return Array.from({ length: maximumPathPoints }, (_, index) => {
    const sourceIndex = Math.round(
      (index / (maximumPathPoints - 1)) * (valid.length - 1),
    );
    return valid[sourceIndex];
  });
}
