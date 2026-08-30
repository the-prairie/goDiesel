import { MapPin, Play } from "lucide-react";

import type { PlannedRoute } from "@/domain/planning";
import type { RoutePoint } from "@/domain/route";
import { RouteSatelliteThumbnail } from "@/ui/route-satellite-thumbnail";

const previewWidth = 720;
const previewHeight = 520;

export function PlannedRoutePreview({ route }: { route: PlannedRoute }) {
  const source = route.planning.sourceSnapshot ?? route;
  const geometry = routePreviewGeometry(source.trace);

  return (
    <section
      aria-label="Living planning preview"
      data-testid="planned-route-preview"
      className="group relative h-full min-h-72 overflow-hidden bg-[#102b33] text-white lg:min-h-[40rem]"
    >
      <RouteSatelliteThumbnail
        route={source}
        enabled
        cinematic
        showRoute={false}
        imageClassName="planned-route-preview-camera saturate-[0.82] contrast-[1.08] brightness-[0.78]"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 z-[2] bg-[linear-gradient(180deg,rgba(5,20,27,0.62),rgba(5,20,27,0.08)_35%,rgba(5,20,27,0.18)_64%,rgba(5,20,27,0.82))]"
      />

      {geometry ? (
        <svg
          viewBox={`0 0 ${previewWidth} ${previewHeight}`}
          role="img"
          aria-label={`${source.region} recorded planning-source route`}
          className="absolute inset-0 z-[3] size-full"
          preserveAspectRatio="xMidYMid meet"
        >
          <path
            d={geometry.path}
            fill="none"
            stroke="rgb(3 15 20 / 72%)"
            strokeWidth="13"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={geometry.path}
            fill="none"
            stroke="rgb(255 250 242 / 88%)"
            strokeWidth="7"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={geometry.path}
            pathLength="1"
            fill="none"
            stroke="#ff8065"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            className="planned-route-preview-progress"
          />
          <circle
            cx={geometry.start.x}
            cy={geometry.start.y}
            r="8"
            fill="#ff8065"
            stroke="white"
            strokeWidth="4"
          />
          <circle
            cx={geometry.end.x}
            cy={geometry.end.y}
            r="8"
            fill="#163b36"
            stroke="white"
            strokeWidth="4"
          />
          <circle r="9" fill="#ff8065" stroke="white" strokeWidth="4" className="motion-reduce:hidden">
            <animateMotion
              dur="9s"
              repeatCount="indefinite"
              path={geometry.path}
              calcMode="spline"
              keyTimes="0;1"
              keySplines="0.45 0 0.2 1"
            />
          </circle>
        </svg>
      ) : null}

      <div className="absolute inset-x-0 top-0 z-[4] flex items-center justify-between gap-3 p-4 md:p-5">
        <span className="inline-flex min-h-9 items-center gap-2 bg-[#07151c]/82 px-3 text-caption font-semibold backdrop-blur-md">
          <Play className="size-3.5 fill-current" aria-hidden="true" />
          Living route preview
        </span>
        <span className="bg-white/92 px-3 py-2 text-micro font-semibold uppercase text-[#17302d]">
          Source-backed satellite
        </span>
      </div>

      <div className="absolute inset-x-0 bottom-0 z-[4] p-5 md:p-7">
        <p className="text-micro font-semibold uppercase text-white/65">The line you are saving</p>
        <p className="mt-1 flex items-center gap-2 font-editorial text-2xl font-semibold md:text-3xl">
          <MapPin className="size-5 text-[#ff8065]" aria-hidden="true" />
          {source.region}
        </p>
        <p className="mt-2 max-w-lg text-caption leading-5 text-white/72">
          Recorded geometry provides the planning reference. The moving highlight is a preview,
          not evidence that this route has been completed again.
        </p>
      </div>
    </section>
  );
}

function routePreviewGeometry(points: RoutePoint[]) {
  if (points.length < 2) return undefined;
  const lngs = points.map((point) => point.lng);
  const lats = points.map((point) => point.lat);
  const minimumLng = Math.min(...lngs);
  const maximumLng = Math.max(...lngs);
  const minimumLat = Math.min(...lats);
  const maximumLat = Math.max(...lats);
  const width = Math.max(maximumLng - minimumLng, 0.00001);
  const height = Math.max(maximumLat - minimumLat, 0.00001);
  const padding = 72;
  const scale = Math.min(
    (previewWidth - padding * 2) / width,
    (previewHeight - padding * 2) / height,
  );
  const renderedWidth = width * scale;
  const renderedHeight = height * scale;
  const offsetX = (previewWidth - renderedWidth) / 2;
  const offsetY = (previewHeight - renderedHeight) / 2;
  const projected = points.map((point) => ({
    x: offsetX + (point.lng - minimumLng) * scale,
    y: offsetY + (maximumLat - point.lat) * scale,
  }));

  return {
    path: projected
      .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
      .join(" "),
    start: projected[0],
    end: projected.at(-1)!,
  };
}
