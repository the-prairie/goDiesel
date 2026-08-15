import { ChevronLeft, ChevronRight, Gauge, Pause, Play } from "lucide-react";

import { routeRepairs } from "@/domain/geometry/route-repairs";
import type { QuestRoute } from "@/domain/route";
import { ReplayElevationScrubber } from "@/surfaces/replay/components/replay-elevation-scrubber";
import {
  formatReplayDuration,
  formatReplayPace,
  ReplayCameraControls,
} from "@/surfaces/replay/components/replay-presentation";
import {
  cycleGoogleRouteSpeed,
  seekGoogleRouteNavigator,
  type GoogleRouteCameraMode,
  type GoogleRouteNavigatorState,
  type GoogleRouteTelemetry,
} from "@/surfaces/replay/playback/route-navigator-controller";
import {
  replayClimbM,
  type ReplayStoryChapter,
} from "@/surfaces/replay/story-flight/story-flight-chapters";
import { Button } from "@/ui/button";

interface StoryFlightReplayHudProps {
  activeChapterIndex: number;
  chapters: ReplayStoryChapter[];
  control: GoogleRouteNavigatorState;
  disabled: boolean;
  onCommit: (
    update: (current: GoogleRouteNavigatorState) => GoogleRouteNavigatorState,
  ) => void;
  onSelectCamera: (mode: GoogleRouteCameraMode) => void;
  onTogglePlayback: () => void;
  route: QuestRoute;
  telemetry: GoogleRouteTelemetry;
  totalDistanceM: number;
}

export function StoryFlightReplayHud({
  activeChapterIndex,
  chapters,
  control,
  disabled,
  onCommit,
  onSelectCamera,
  onTogglePlayback,
  route,
  telemetry,
  totalDistanceM,
}: StoryFlightReplayHudProps) {
  const repairCount = routeRepairs(route, totalDistanceM).length;
  const activeChapter = chapters[activeChapterIndex];
  const seekChapter = (index: number) => {
    const chapter = chapters[index];
    if (!chapter) return;
    onCommit((current) =>
      seekGoogleRouteNavigator(current, chapter.progressM, totalDistanceM),
    );
  };

  return (
    <div className="px-2 pb-[max(0.25rem,var(--safe-area-bottom))] sm:px-4 sm:pb-[max(1rem,var(--safe-area-bottom))]">
      <div className="pointer-events-auto mb-1 ml-auto grid w-full grid-cols-6 rounded-md border border-white/45 bg-[#1d2d50]/72 p-1 text-white shadow-xl backdrop-blur-xl sm:mb-2 sm:w-[min(47rem,calc(100vw-2rem))] sm:p-1.5">
        <StoryMetric
          label="Distance"
          mobileValue={`${(control.progressM / 1_000).toFixed(2)} km`}
          testId="google-route-progress"
          value={`${(control.progressM / 1_000).toFixed(2)} / ${route.distanceKm.toFixed(1)} km`}
        />
        <StoryMetric label="Elevation" value={`${Math.round(telemetry.elevationM)} m`} />
        <StoryMetric
          label="Climb"
          value={`+${Math.round(replayClimbM(route, control.progressM))} m`}
        />
        <StoryMetric
          label="Grade"
          value={`${telemetry.gradePercent >= 0 ? "+" : ""}${telemetry.gradePercent.toFixed(1)}%`}
        />
        <StoryMetric
          label={route.type.toLowerCase().includes("ride") ? "Speed" : "Pace"}
          value={formatReplayPace(telemetry.paceSPerKm, route.type)}
        />
        <StoryMetric
          label="Elapsed"
          value={formatReplayDuration(telemetry.elapsedS)}
        />
      </div>

      <div
        className="pointer-events-auto grid min-h-[6.75rem] grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-white/60 bg-[#f5f7fb]/94 p-2 text-[#1d2946] shadow-2xl backdrop-blur-xl sm:grid-cols-[3.5rem_minmax(0,1fr)_auto] sm:gap-3 sm:p-3"
        data-testid="story-flight-controls"
      >
        <Button
          aria-label={control.playing ? "Pause route" : "Play route"}
          className="rounded-full border border-[#ffcfb3] bg-[#ffdfca] text-[#1d2946] hover:bg-[#ffd2b5]"
          disabled={disabled}
          onClick={onTogglePlayback}
          size="icon"
          type="button"
        >
          {control.playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
        </Button>

        <div className="min-w-0">
          <nav
            aria-label="Chapter stepper"
            className="flex h-11 min-w-0 items-center justify-between gap-1 lg:hidden"
          >
            <button
              aria-label={
                activeChapterIndex > 0
                  ? `Previous chapter: ${chapters[activeChapterIndex - 1].label}`
                  : "Previous chapter"
              }
              className="grid size-11 shrink-0 place-items-center rounded-sm border border-[#c7cfdd] bg-white/55 text-[#60708e] outline-none hover:bg-white hover:text-[#1d2946] focus-visible:ring-2 focus-visible:ring-[#d86f9e] disabled:border-transparent disabled:bg-transparent disabled:opacity-30"
              disabled={disabled || activeChapterIndex === 0}
              onClick={() => seekChapter(activeChapterIndex - 1)}
              type="button"
            >
              <ChevronLeft aria-hidden="true" className="size-4" />
            </button>

            <div
              aria-live="polite"
              className="min-w-0 flex-1 text-center leading-tight"
              data-testid="story-flight-chapter-status"
            >
              <div className="truncate text-xs font-semibold text-[#1d2946]">
                {activeChapterIndex + 1} of {chapters.length}
                {activeChapter ? ` · ${activeChapter.label}` : ""}
              </div>
              {repairCount > 0 ? (
                <div className="mt-1 flex items-center justify-center gap-1.5 text-[10px] font-medium text-[#6e5a34]">
                  <span
                    aria-hidden="true"
                    className="size-1.5 rotate-45 bg-[#b58a3a]"
                  />
                  {repairCount} route data {repairCount === 1 ? "note" : "notes"}
                </div>
              ) : null}
            </div>

            <button
              aria-label={
                activeChapterIndex < chapters.length - 1
                  ? `Next chapter: ${chapters[activeChapterIndex + 1].label}`
                  : "Next chapter"
              }
              className="grid size-11 shrink-0 place-items-center rounded-sm border border-[#c7cfdd] bg-white/55 text-[#60708e] outline-none hover:bg-white hover:text-[#1d2946] focus-visible:ring-2 focus-visible:ring-[#d86f9e] disabled:border-transparent disabled:bg-transparent disabled:opacity-30"
              disabled={disabled || activeChapterIndex === chapters.length - 1}
              onClick={() => seekChapter(activeChapterIndex + 1)}
              type="button"
            >
              <ChevronRight aria-hidden="true" className="size-4" />
            </button>
          </nav>

          <div className="relative min-w-0">
            <nav
              aria-label="Replay chapters"
              className="pointer-events-none absolute inset-x-1 top-0 z-40 hidden h-11 lg:block"
            >
              {chapters.map((chapter, index) => (
                <button
                  aria-current={
                    activeChapterIndex === index ? "step" : undefined
                  }
                  aria-label={`Chapter ${index + 1} of ${chapters.length}: Go to ${chapter.label} at ${(chapter.progressM / 1_000).toFixed(1)} km`}
                  className="group pointer-events-auto absolute top-0 grid min-h-11 w-11 justify-items-center gap-0.5 rounded-sm px-0.5 text-[#60708e] outline-none hover:text-[#1d2946] focus-visible:ring-2 focus-visible:ring-[#d86f9e] aria-[current=step]:text-[#b94f83] lg:w-24"
                  key={chapter.kind}
                  onClick={() => seekChapter(index)}
                  style={{
                    left: `${chapter.progressRatio * 100}%`,
                    transform:
                      index === 0
                        ? "none"
                        : index === chapters.length - 1
                          ? "translateX(-100%)"
                          : "translateX(-50%)",
                  }}
                  type="button"
                >
                  <span className="size-2.5 rounded-full border-2 border-white bg-[#b8afd9] shadow-[0_0_0_1px_#9ca8bf] group-aria-[current=step]:bg-[#e789bd] group-aria-[current=step]:shadow-[0_0_0_6px_rgba(231,137,189,.2)]" />
                  <strong className="hidden max-w-full truncate text-[10px] font-semibold lg:block">
                    {chapter.label}
                  </strong>
                </button>
              ))}
            </nav>
            <ReplayElevationScrubber
              className="h-12 rounded-md border-0 bg-transparent lg:h-[5.25rem] lg:pt-6"
              compact
              disabled={disabled}
              onSeek={(progressM) =>
                onCommit((current) =>
                  seekGoogleRouteNavigator(current, progressM, totalDistanceM),
                )
              }
              progressM={control.progressM}
              route={route}
              totalDistanceM={totalDistanceM}
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden lg:block">
            <ReplayCameraControls
              active={control.cameraMode}
              disabled={disabled}
              onSelect={onSelectCamera}
              tone="story"
            />
          </div>
          <Button
            aria-label={`Playback speed ${control.speed}x`}
            className="border-[#9ca8bf] bg-transparent text-[#1d2946] hover:bg-white"
            disabled={disabled}
            onClick={() => onCommit(cycleGoogleRouteSpeed)}
            size="sm"
            title="Change playback speed"
            type="button"
            variant="outline"
          >
            <Gauge aria-hidden="true" />
            <span className="hidden sm:inline">{control.speed}x</span>
          </Button>
        </div>
      </div>
    </div>
  );
}

function StoryMetric({
  label,
  mobileValue,
  testId,
  value,
}: {
  label: string;
  mobileValue?: string;
  testId?: string;
  value: string;
}) {
  return (
    <div className="min-w-0 border-r border-white/18 px-1 py-1 last:border-r-0 sm:px-2">
      <div className="text-[8px] font-semibold uppercase text-white/55">{label}</div>
      <div
        className="mt-0.5 truncate text-[11px] font-semibold tabular-nums sm:text-xs"
        data-testid={testId}
      >
        {mobileValue ? (
          <>
            <span className="sm:hidden">{mobileValue}</span>
            <span className="hidden sm:inline">{value}</span>
          </>
        ) : (
          value
        )}
      </div>
    </div>
  );
}
