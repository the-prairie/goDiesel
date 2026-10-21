import { Gauge, LocateFixed, Pause, Play, Settings2 } from "lucide-react";
import { useId, useMemo } from "react";

import type { Course } from "@/domain/courses";
import {
  coursePreviewPosition,
  type CoursePreviewSection,
} from "@/surfaces/replay/playback/course-preview-model";
import {
  coursePreviewProfile,
  courseProfileHeight,
} from "@/surfaces/replay/playback/course-preview-profile";
import type {
  ReplaySessionEvent,
  ReplaySessionState,
} from "@/surfaces/replay/playback/replay-session-state";
import { Button } from "@/ui/button";
import { SelectField } from "@/ui/select-field";
import { SegmentedControl } from "@/ui/segmented-control";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/ui/sheet";
import "./replay-chapter-controls.css";
import "../course-preview.css";

export function CoursePreviewControls({
  course,
  section,
  sections,
  control,
  ready,
  onSection,
  onControl,
  onTogglePlayback,
}: {
  course: Course;
  section: CoursePreviewSection;
  sections: CoursePreviewSection[];
  control: ReplaySessionState;
  ready: boolean;
  onSection: (index: number) => void;
  onControl: (event: ReplaySessionEvent) => void;
  onTogglePlayback: () => void;
}) {
  const segmented = course.segments.length > 1;

  return (
    <div
      className="immersive-replay-dock replay-chapter-controls course-preview-controls z-20"
      data-testid="course-preview-controls"
    >
      {!control.following ? (
        <Button
          className="course-preview-resume"
          variant="outline"
          disabled={!ready}
          onClick={() =>
            onControl({ type: "followingChanged", following: true })
          }
        >
          <LocateFixed aria-hidden="true" />
          Follow
        </Button>
      ) : null}
      <div className="replay-chapter-transport">
        <Button
          className="replay-chapter-play"
          size="icon"
          disabled={!ready}
          aria-label={control.playing ? "Pause preview" : "Play preview"}
          onClick={onTogglePlayback}
        >
          {control.playing ? (
            <Pause aria-hidden="true" />
          ) : (
            <Play aria-hidden="true" />
          )}
        </Button>
        <div className="replay-chapter-progress">
          <strong>
            <output data-testid="course-preview-distance">
              {distance(control.progressM)} / {distance(section.distanceM)} km
            </output>
          </strong>
          <small>
            {segmented ? `Section ${section.sectionNumber}` : "Planned course"}{" "}
            · {control.playing ? "Playing" : "Paused"}
          </small>
        </div>
        <Button
          className="replay-chapter-button replay-chapter-speed"
          variant="ghost"
          aria-label={`Preview speed ${control.speed}×`}
          title="Change preview speed"
          disabled={!ready}
          onClick={() => onControl({ type: "speedCycled" })}
        >
          <Gauge aria-hidden="true" />
          {control.speed}×
        </Button>
        <Sheet>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Preview settings"
              title="Camera and course details"
            >
              <Settings2 aria-hidden="true" />
            </Button>
          </SheetTrigger>
          <SheetContent
            side="bottom"
            className="mx-auto max-h-[calc(100dvh-2rem)] w-[min(24rem,100%)] overflow-y-auto rounded-t-[var(--radius-panel)] pb-[env(safe-area-inset-bottom)]"
          >
            <SheetHeader className="pr-12">
              <SheetTitle>Preview settings</SheetTitle>
              <SheetDescription>
                Planned course. No recorded pace or elapsed time.
              </SheetDescription>
            </SheetHeader>
            <div className="grid gap-6 px-4 pb-6">
              {segmented ? (
                <div className="grid gap-2">
                  <SelectField
                    label="Course section"
                    value={String(section.sectionNumber)}
                    options={sections.map(
                      (item) =>
                        [
                          String(item.sectionNumber),
                          `Section ${item.sectionNumber} · ${item.distanceKm.toFixed(1)} km`,
                        ] as const,
                    )}
                    onChange={(value) =>
                      onSection(
                        sections.findIndex(
                          (item) => item.sectionNumber === Number(value),
                        ),
                      )
                    }
                  />
                  <p className="text-xs text-ink-secondary">
                    Sections preview separately. Gaps are not connected.
                    {sections.length < course.segments.length
                      ? " Sections with no path have no playback."
                      : ""}
                  </p>
                </div>
              ) : null}
              {section.completeElevation ? (
                <SegmentedControl
                  label="Preview camera"
                  value={control.cameraMode}
                  options={[
                    ["chase", "Follow"],
                    ["overview", "Overview"],
                  ]}
                  disabled={!ready}
                  onChange={(value) =>
                    onControl({
                      type: "cameraSelected",
                      cameraMode: value === "overview" ? "overview" : "chase",
                    })
                  }
                />
              ) : (
                <p className="text-sm text-ink-secondary">
                  Elevation is incomplete. The camera uses a high overview.
                </p>
              )}
            </div>
          </SheetContent>
        </Sheet>
      </div>
      <CoursePreviewProfile
        section={section}
        progressM={control.progressM}
        disabled={!ready}
        onSeek={(progressM) =>
          onControl({
            type: "progressSelected",
            progressM,
            totalDistanceM: section.distanceM,
          })
        }
      />
    </div>
  );
}

function CoursePreviewProfile({
  section,
  progressM,
  disabled,
  onSeek,
}: {
  section: CoursePreviewSection;
  progressM: number;
  disabled: boolean;
  onSeek: (progressM: number) => void;
}) {
  const clipId = useId();
  const profile = useMemo(() => coursePreviewProfile(section), [section]);
  const y = (elevationM: number) =>
    39 - courseProfileHeight(elevationM, profile) * 30;
  const paths = useMemo(
    () =>
      profile.segments.map((segment) =>
        segment
          .map(
            (point, index) =>
              `${index ? "L" : "M"}${((point.distanceM / section.distanceM) * 1000).toFixed(2)} ${(39 - courseProfileHeight(point.elevationM, profile) * 30).toFixed(2)}`,
          )
          .join(" "),
      ),
    [profile, section.distanceM],
  );
  const elevationM = coursePreviewPosition(section, progressM).altitude;
  const ratio = Math.max(0, Math.min(1, progressM / section.distanceM));
  const hasElevation = profile.segments.length > 0;
  const elevationLabel =
    elevationM === undefined
      ? "Elevation unavailable here"
      : `${Math.round(elevationM).toLocaleString()} m elevation`;

  return (
    <>
      <div
        className="course-preview-profile"
        data-testid="course-preview-profile"
        data-profile-kind={hasElevation ? "elevation" : "distance"}
      >
        <svg
          viewBox="0 0 1000 48"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <clipPath id={clipId}>
              <rect width={ratio * 1000} height="48" />
            </clipPath>
          </defs>
          {hasElevation ? (
            <>
              {paths.map((path, index) => (
                <path
                  key={index}
                  d={path}
                  className="course-preview-profile-line"
                />
              ))}
              <g
                clipPath={`url(#${clipId})`}
                className="course-preview-profile-played"
              >
                {paths.map((path, index) => (
                  <path
                    key={index}
                    d={path}
                    className="course-preview-profile-line"
                  />
                ))}
              </g>
            </>
          ) : (
            <>
              <path d="M0 24 H1000" className="course-preview-profile-line" />
              <path
                d={`M0 24 H${ratio * 1000}`}
                className="course-preview-profile-line course-preview-profile-played"
              />
            </>
          )}
        </svg>
        {profile.segments
          .filter((segment) => segment.length === 1)
          .map(([point], index) => (
            <span
              key={index}
              className="course-preview-isolated-sample"
              aria-hidden="true"
              style={{
                left: `${(point.distanceM / section.distanceM) * 100}%`,
                top: `${(y(point.elevationM) / 48) * 100}%`,
              }}
            />
          ))}
        {elevationM !== undefined || !hasElevation ? (
          <span
            className="replay-chapter-pin"
            data-testid="course-preview-playhead"
            aria-hidden="true"
            style={{
              left: `${ratio * 100}%`,
              top: `${elevationM === undefined ? 50 : (y(elevationM) / 48) * 100}%`,
            }}
          />
        ) : (
          <span
            className="course-preview-gap-cursor"
            aria-hidden="true"
            style={{ left: `${ratio * 100}%` }}
          />
        )}
        <input
          type="range"
          aria-label="Preview distance"
          aria-valuetext={`${distance(progressM)} of ${distance(section.distanceM)} kilometers. ${elevationLabel}.`}
          min={0}
          max={section.distanceM}
          step={1}
          value={progressM}
          disabled={disabled}
          onChange={(event) => onSeek(Number(event.target.value))}
        />
      </div>
      <div className="course-preview-axis">
        <span>0 km</span>
        <span>
          {hasElevation ? elevationLabel : "Elevation unavailable · Overview"}
        </span>
        <span>{distance(section.distanceM)} km</span>
      </div>
    </>
  );
}

function distance(meters: number) {
  return (meters / 1_000).toFixed(2);
}
