import type { QuestRoute } from "@/domain/route";
import {
  elevationRange,
  sampleElevationProfile,
} from "@/domain/geometry/route-visualization";

const profileWidth = 640;
const profileHeight = 180;

export function ElevationProfile({ route }: { route: QuestRoute }) {
  const points = sampleElevationProfile(route.route);
  const { minimum, maximum } = elevationRange(route.route);
  const range = Math.max(1, maximum - minimum);
  const totalDistance = Math.max(1, points.at(-1)?.d ?? route.distanceKm * 1_000);
  const left = 22;
  const right = profileWidth - 22;
  const top = 22;
  const bottom = profileHeight - 34;
  const rendered = points.map((point) => ({
    x: left + (point.d / totalDistance) * (right - left),
    y: bottom - ((point.elev - minimum) / range) * (bottom - top),
  }));
  const line = rendered.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `M ${rendered[0].x.toFixed(1)} ${bottom} L ${line.replaceAll(",", " ")} L ${rendered.at(-1)!.x.toFixed(1)} ${bottom} Z`;

  return (
    <div className="grid min-h-48 grid-rows-[minmax(0,1fr)_auto] bg-accent/15 px-3 pb-3 pt-2">
      <svg
        viewBox={`0 0 ${profileWidth} ${profileHeight}`}
        role="img"
        aria-label={`${route.name} elevation profile from ${Math.round(minimum)} to ${Math.round(maximum)} metres`}
        className="h-full min-h-0 w-full"
        preserveAspectRatio="none"
      >
        <line
          x1={left}
          x2={right}
          y1={bottom}
          y2={bottom}
          stroke="var(--border)"
          strokeWidth="1"
        />
        <path
          d={area}
          fill="color-mix(in srgb, var(--primary) 16%, transparent)"
        />
        <polyline
          points={line}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="flex justify-between gap-4 px-1 text-xs text-muted-foreground">
        <span>{Math.round(minimum).toLocaleString()} m low</span>
        <span>{Math.round(maximum).toLocaleString()} m high</span>
      </div>
    </div>
  );
}
