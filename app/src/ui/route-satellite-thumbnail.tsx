import { useEffect, useMemo, useState } from "react";

import type { RoutePoint, RouteSummary } from "@/domain/route";
import { cn } from "@/ui/utils";

const thumbnailWidth = 640;
const thumbnailHeight = 224;
const maximumPathPoints = 36;

type RouteThumbnailState =
  | "deferred"
  | "loading"
  | "loaded"
  | "failed"
  | "unavailable";

declare global {
  interface Window {
    __GODIESEL_STATIC_MAPS_API_KEY__?: string;
  }
}

export function RouteSatelliteThumbnail({
  route,
  enabled,
  cinematic = false,
  showRoute = true,
  className,
  imageClassName,
}: {
  route: RouteSummary;
  enabled: boolean;
  cinematic?: boolean;
  showRoute?: boolean;
  className?: string;
  imageClassName?: string;
}) {
  const url = useMemo(
    () =>
      routeSatelliteThumbnailUrl(
        route.trace,
        window.__GODIESEL_STATIC_MAPS_API_KEY__ ||
          import.meta.env.VITE_GOOGLE_MAPS_API_KEY ||
          "",
        cinematic ? { width: 640, height: 640 } : undefined,
        showRoute,
      ),
    [cinematic, route.trace, showRoute],
  );
  const [state, setState] = useState<RouteThumbnailState>(() =>
    thumbnailState(enabled, url),
  );

  useEffect(() => {
    setState((currentState) =>
      nextThumbnailState(currentState, enabled, url),
    );
  }, [enabled, url]);

  const requestImage =
    Boolean(url) && state !== "failed" && (enabled || state === "loaded");

  return (
    <div
      data-route-thumbnail={route.slug}
      data-thumbnail-state={state}
      className={cn(
        "pointer-events-none absolute inset-0 z-[1] overflow-hidden",
        className,
      )}
    >
      {requestImage ? (
        <img
          src={url!}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={() => setState("loaded")}
          onError={() => setState("failed")}
          className={cn(
            "size-full object-cover transition-opacity duration-200 motion-reduce:transition-none",
            state === "loaded" ? "opacity-100" : "opacity-0",
            imageClassName,
          )}
        />
      ) : null}
    </div>
  );
}

function thumbnailState(
  enabled: boolean,
  url: string | null,
): RouteThumbnailState {
  if (!enabled) return "deferred";
  return url ? "loading" : "unavailable";
}

export function nextThumbnailState(
  currentState: RouteThumbnailState,
  enabled: boolean,
  url: string | null,
): RouteThumbnailState {
  if (!url) return "unavailable";
  if (currentState === "loaded" || currentState === "failed") {
    return currentState;
  }
  return enabled ? "loading" : "deferred";
}

export function routeSatelliteThumbnailUrl(
  points: RoutePoint[],
  apiKey: string,
  size: { width: number; height: number } = {
    width: thumbnailWidth,
    height: thumbnailHeight,
  },
  showRoute = true,
) {
  const path = downsampleThumbnailPath(points);
  if (!apiKey || path.length < 2) return null;

  const params = new URLSearchParams({
    size: `${size.width}x${size.height}`,
    scale: "2",
    maptype: "satellite",
    format: "png",
    key: apiKey,
  });

  params.set(
    "path",
    `${showRoute ? "color:0x63d6cfff|weight:4" : "color:0x00000000|weight:1"}|${path
      .map((point) => `${point.lat.toFixed(5)},${point.lng.toFixed(5)}`)
      .join("|")}`,
  );

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
