import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import { RepairEvidence } from "@/surfaces/routes/components/repair-evidence";
import {
  routeRepairAriaLabel,
  routeRepairs,
  type RouteRepair,
} from "@/domain/geometry/route-repairs";
import type { QuestRoute } from "@/domain/route";
import {
  elevationRange,
  sampleElevationProfile,
} from "@/domain/geometry/route-visualization";
import { cn } from "@/ui/utils";

const PROFILE_WIDTH = 720;
const PROFILE_HEIGHT = 92;
const TRAVELED_COLOR = "#315fb4";
const FUTURE_COLOR = "#aebad0";
const PLAYHEAD_COLOR = "#d95d45";
const INTELLIGENCE_TRAVELED_COLOR = "#ef684e";
const INTELLIGENCE_FUTURE_COLOR = "#f6f3ed";
const INTELLIGENCE_PLAYHEAD_COLOR = "#ef684e";

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
    tone?: "default" | "intelligence";
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
    tone = "default",
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
  const repairs = useMemo(
    () => routeRepairs(route, totalDistanceM),
    [route, totalDistanceM],
  );
  const [activeRepairs, setActiveRepairs] = useState<RouteRepair[]>([]);
  const repairGroups = useMemo(() => {
    const groups: RouteRepair[][] = [];
    for (const repair of repairs) {
      const previous = groups.at(-1);
      if (
        previous &&
        repair.distanceRatio - previous.at(-1)!.distanceRatio < 0.04
      ) {
        previous.push(repair);
      } else {
        groups.push([repair]);
      }
    }
    return groups;
  }, [repairs]);
  const repairYRatio = (distanceRatio: number) =>
    profileYAtRatio(profile.points, distanceRatio) / PROFILE_HEIGHT;
  const traveledColor =
    tone === "intelligence" ? INTELLIGENCE_TRAVELED_COLOR : TRAVELED_COLOR;
  const futureColor =
    tone === "intelligence" ? INTELLIGENCE_FUTURE_COLOR : FUTURE_COLOR;
  const playheadColor =
    tone === "intelligence" ? INTELLIGENCE_PLAYHEAD_COLOR : PLAYHEAD_COLOR;

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
      data-traveled-color={traveledColor}
      data-playhead-color={playheadColor}
      className={cn(
        "group relative min-w-0 overflow-visible focus-within:ring-2 focus-within:ring-route focus-within:ring-inset",
        tone === "intelligence"
          ? "border-x border-white/15 bg-black/45"
          : "border-x border-line bg-surface",
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
          stroke={tone === "intelligence" ? "rgba(255,255,255,0.2)" : "var(--line)"}
          strokeWidth="1"
        />
        <path
          d={profile.area}
          fill={tone === "intelligence" ? "#253a3a" : "#dfe5ee"}
          opacity={tone === "intelligence" ? "0.6" : "0.72"}
        />
        <polyline
          points={profile.line}
          fill="none"
          stroke={futureColor}
          opacity={tone === "intelligence" ? "0.62" : "1"}
          strokeWidth="2.5"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <polyline
          points={profile.line}
          clipPath={`url(#${clipId})`}
          fill="none"
          stroke={traveledColor}
          strokeWidth="3"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-y-0 left-[var(--replay-progress)] z-10 w-px -translate-x-1/2",
          tone === "intelligence" ? "bg-[#ef684e]" : "bg-coral",
        )}
      >
        <span
          className={cn(
            "absolute left-1/2 top-2 size-3 -translate-x-1/2 rounded-full border-2 shadow-sm",
            tone === "intelligence"
              ? "border-black bg-[#ef684e]"
              : "border-surface bg-coral",
          )}
        />
      </span>

      {repairs.map((repair) => (
        <span
          key={repair.id}
          data-testid="replay-repair-mark"
          data-repair-distance-m={repair.distanceM.toFixed(2)}
          aria-hidden="true"
          className="pointer-events-none absolute z-30 size-2 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-surface bg-repair shadow-sm"
          style={{
            left: `${repair.distanceRatio * 100}%`,
            top: `${repairYRatio(repair.distanceRatio) * 100}%`,
          }}
        />
      ))}

      {repairGroups.map((group) => {
        const distanceRatio =
          group.reduce((sum, repair) => sum + repair.distanceRatio, 0) / group.length;
        const yRatio =
          group.reduce((sum, repair) => sum + repairYRatio(repair.distanceRatio), 0) /
          group.length;
        return (
          <button
            key={group.map(({ id }) => id).join("-")}
            type="button"
            aria-label={
              group.length === 1
                ? routeRepairAriaLabel(group[0])
                : `${group.length} recorded repairs near ${(
                    group.reduce((sum, repair) => sum + repair.distanceM, 0) /
                    group.length /
                    1_000
                  ).toFixed(2)} km`
            }
            className="absolute z-30 size-11 -translate-x-1/2 -translate-y-1/2 outline-none focus-visible:ring-2 focus-visible:ring-repair focus-visible:ring-inset"
            style={{
              left: `${distanceRatio * 100}%`,
              top: `${yRatio * 100}%`,
            }}
            onClick={() => setActiveRepairs(group)}
          />
        );
      })}

      {activeRepairs.length > 0 ? (
        <RepairEvidence
          repairs={activeRepairs}
          className="absolute bottom-full left-3 z-40 mb-2 max-w-[min(22rem,calc(100%-1.5rem))]"
        />
      ) : null}

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

      <div
        className={cn(
          "pointer-events-none absolute inset-x-3 bottom-1 z-10 flex justify-between text-[10px] font-semibold",
          tone === "intelligence" ? "text-white/55" : "text-ink-muted",
        )}
      >
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
      points: [
        { x: 0, y },
        { x: PROFILE_WIDTH, y },
      ],
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
    points: rendered,
  };
}

function profileYAtRatio(
  points: Array<{ x: number; y: number }>,
  distanceRatio: number,
) {
  const targetX = Math.min(1, Math.max(0, distanceRatio)) * PROFILE_WIDTH;
  for (let index = 1; index < points.length; index += 1) {
    const current = points[index];
    if (current.x < targetX) continue;
    const previous = points[index - 1];
    const span = current.x - previous.x;
    const ratio = span > 0 ? (targetX - previous.x) / span : 0;
    return previous.y + (current.y - previous.y) * ratio;
  }
  return points.at(-1)?.y ?? PROFILE_HEIGHT / 2;
}
