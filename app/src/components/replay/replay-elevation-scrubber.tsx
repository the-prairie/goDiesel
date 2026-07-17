import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";

import type { QuestRoute } from "@/domain/routes";
import {
  elevationRange,
  sampleElevationProfile,
} from "@/domain/route-visualization";
import { cn } from "@/lib/utils";

const PROFILE_WIDTH = 720;
const PROFILE_HEIGHT = 92;
const TRAVELED_COLOR = "#315fb4";
const FUTURE_COLOR = "#aebad0";
const PLAYHEAD_COLOR = "#d95d45";

export interface ReplayElevationScrubberHandle {
  sync(progressM: number): void;
}

export const ReplayElevationScrubber = forwardRef<
  ReplayElevationScrubberHandle,
  {
    route: QuestRoute;
    progressM: number;
    totalDistanceM: number;
    disabled?: boolean;
    compact?: boolean;
    className?: string;
    onSeek: (progressM: number) => void;
  }
>(function ReplayElevationScrubber(
  {
    route,
    progressM,
    totalDistanceM,
    disabled = false,
    compact = false,
    className,
    onSeek,
  },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const clipId = useId().replaceAll(":", "");
  const profile = useMemo(
    () => buildProfile(route, totalDistanceM),
    [route, totalDistanceM],
  );

  const sync = (nextProgressM: number) => {
    const ratio = Math.min(1, Math.max(0, nextProgressM / totalDistanceM));
    hostRef.current?.style.setProperty("--replay-progress", `${ratio * 100}%`);
  };

  useImperativeHandle(ref, () => ({ sync }), [totalDistanceM]);
  useEffect(() => sync(progressM), [progressM, totalDistanceM]);

  return (
    <div
      ref={hostRef}
      data-testid="replay-elevation-scrubber"
      data-distance-axis="route-metres"
      data-traveled-color={TRAVELED_COLOR}
      data-playhead-color={PLAYHEAD_COLOR}
      className={cn(
        "group relative min-w-0 overflow-hidden border-x border-line bg-surface focus-within:ring-2 focus-within:ring-route focus-within:ring-inset",
        compact ? "h-[4.5rem]" : "h-[6.25rem]",
        className,
      )}
      style={{ "--replay-progress": "0%" } as React.CSSProperties}
    >
      <svg
        viewBox={`0 0 ${PROFILE_WIDTH} ${PROFILE_HEIGHT}`}
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-full w-full"
        preserveAspectRatio="none"
      >
        <defs>
          <clipPath id={clipId}>
            <rect
              x="0"
              y="0"
              width="var(--replay-progress)"
              height={PROFILE_HEIGHT}
            />
          </clipPath>
        </defs>
        <line
          x1="0"
          x2={PROFILE_WIDTH}
          y1={PROFILE_HEIGHT - 10}
          y2={PROFILE_HEIGHT - 10}
          stroke="var(--line)"
          strokeWidth="1"
        />
        <path d={profile.area} fill="#dfe5ee" opacity="0.72" />
        <polyline
          points={profile.line}
          fill="none"
          stroke={FUTURE_COLOR}
          strokeWidth="2.5"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <polyline
          points={profile.line}
          clipPath={`url(#${clipId})`}
          fill="none"
          stroke={TRAVELED_COLOR}
          strokeWidth="3"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-[var(--replay-progress)] z-10 w-px -translate-x-1/2 bg-coral"
      >
        <span className="absolute left-1/2 top-2 size-3 -translate-x-1/2 rounded-full border-2 border-surface bg-coral shadow-sm" />
      </span>

      <input
        aria-label="Route progress"
        type="range"
        min={0}
        max={totalDistanceM}
        step={1}
        value={progressM}
        disabled={disabled}
        onChange={(event) => onSeek(Number(event.target.value))}
        className="absolute inset-0 z-20 h-full w-full cursor-ew-resize opacity-0 disabled:cursor-not-allowed"
      />

      <div className="pointer-events-none absolute inset-x-3 bottom-1 z-10 flex justify-between text-[10px] font-semibold text-ink-muted">
        <span>0 km</span>
        {!compact ? <span>{(totalDistanceM / 2_000).toFixed(1)} km</span> : null}
        <span>{(totalDistanceM / 1_000).toFixed(1)} km</span>
      </div>
    </div>
  );
});

function buildProfile(route: QuestRoute, totalDistanceM: number) {
  const points = sampleElevationProfile(route.route);
  if (points.length === 0) {
    const y = PROFILE_HEIGHT / 2;
    return {
      line: `0,${y} ${PROFILE_WIDTH},${y}`,
      area: `M 0 ${PROFILE_HEIGHT - 10} L 0 ${y} L ${PROFILE_WIDTH} ${y} L ${PROFILE_WIDTH} ${PROFILE_HEIGHT - 10} Z`,
    };
  }

  const { minimum, maximum } = elevationRange(points);
  const elevationSpan = Math.max(1, maximum - minimum);
  const top = 10;
  const bottom = PROFILE_HEIGHT - 10;
  const rendered = points.map((point) => ({
    x: (point.d / totalDistanceM) * PROFILE_WIDTH,
    y: bottom - ((point.elev - minimum) / elevationSpan) * (bottom - top),
  }));
  const line = rendered
    .map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");

  return {
    line,
    area: `M 0 ${bottom} L ${line.replaceAll(",", " ")} L ${PROFILE_WIDTH} ${bottom} Z`,
  };
}
