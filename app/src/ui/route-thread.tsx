import { CalendarClock } from "lucide-react";
import type { RouteSummary } from "@/domain/route";
import { isPlannedRoute } from "@/domain/planning";
import { cn } from "@/ui/utils";

export function RouteThread({
  route,
  className,
  responsive = false,
}: {
  route: RouteSummary;
  className?: string;
  responsive?: boolean;
}) {
  const points = normalizedTrace(route);

  return (
    <div
      className={cn(
        "relative h-32 overflow-hidden border-b border-line bg-surface-muted",
        className,
      )}
    >
      <div className="absolute inset-0 opacity-45 [background-image:linear-gradient(var(--line)_1px,transparent_1px),linear-gradient(90deg,var(--line)_1px,transparent_1px)] [background-size:24px_24px]" />
      {points ? (
        (responsive
          ? [
              { width: 128, className: "sm:hidden" },
              { width: 320, className: "hidden sm:block" },
            ]
          : [{ width: 320, className: "" }]
        ).map((layout) => (
          <svg
            key={layout.width}
            viewBox={`0 0 ${layout.width} 128`}
            role="img"
            aria-label={`${route.name} route trace`}
            className={cn("absolute inset-0 size-full", layout.className)}
            preserveAspectRatio="xMidYMid meet"
          >
            <polyline
              points={normalizedTrace(route, layout.width)!}
              fill="none"
              stroke="var(--route)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        ))
      ) : (
        <div className="absolute inset-0 grid place-items-center px-2 text-center text-micro text-ink-muted">
          Route trace unavailable
        </div>
      )}
      {isPlannedRoute(route) ? (
        <CalendarClock
          className="absolute bottom-2 right-2 size-4 text-warning"
          aria-label="Planned"
        />
      ) : null}
    </div>
  );
}

function normalizedTrace(route: RouteSummary, viewportWidth = 320) {
  if (route.trace.length < 2) return null;
  const lngs = route.trace.map((point) => point.lng);
  const lats = route.trace.map((point) => point.lat);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const width = Math.max(maxLng - minLng, 0.00001);
  const height = Math.max(maxLat - minLat, 0.00001);
  const scale = Math.min((viewportWidth - 32) / width, 96 / height);
  const renderedWidth = width * scale;
  const renderedHeight = height * scale;
  const offsetX = (viewportWidth - renderedWidth) / 2;
  const offsetY = (128 - renderedHeight) / 2;

  return route.trace
    .map((point) => {
      const x = offsetX + (point.lng - minLng) * scale;
      const y = offsetY + (maxLat - point.lat) * scale;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}
