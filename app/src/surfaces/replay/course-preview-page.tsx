import { ArrowLeft, RotateCcw } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { Link, useParams } from "react-router-dom";

import { courseRequest, courseResult } from "@/data/course-client";
import type { Course } from "@/domain/courses";
import {
  coursePreviewCamera,
  coursePreviewSections,
  type CoursePreviewSection,
} from "@/surfaces/replay/playback/course-preview-model";
import {
  initialCoursePreviewSession,
  reduceCoursePreviewLoad,
  reduceCoursePreviewSession,
  type CoursePreviewLoadState,
  type CoursePreviewSessionEvent,
} from "@/surfaces/replay/playback/course-preview-state";
import type { ReplaySessionEvent } from "@/surfaces/replay/playback/replay-session-state";
import {
  createGoogleRouteNavigatorEngine,
  type GoogleRouteNavigatorEngine,
} from "@/surfaces/replay/renderers/google-route-navigator-engine";
import {
  advanceRouteCameraMotion,
  createRouteCameraMotionState,
  routeCameraMotionHasSettled,
  type RouteCameraMotionState,
} from "@/surfaces/replay/scene/route-camera-stabilizer";
import { Button } from "@/ui/button";
import { useReducedMotion } from "@/ui/use-reduced-motion";
import "./components/immersive-replay.css";
import { CoursePreviewControls } from "./components/course-preview-controls";

export function CoursePreviewPage() {
  const { courseId = "" } = useParams();
  return <CoursePreviewLoader key={courseId} courseId={courseId} />;
}

function CoursePreviewLoader({ courseId }: { courseId: string }) {
  const [state, dispatch] = useReducer(reduceCoursePreviewLoad, {
    phase: "loading",
    operationId: 0,
  } satisfies CoursePreviewLoadState);
  const [attempt, setAttempt] = useState(0);
  const sequence = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    const operationId = ++sequence.current;
    dispatch({ type: "loadStarted", operationId });
    void courseRequest(
      undefined,
      `?id=${encodeURIComponent(courseId)}`,
      controller.signal,
    )
      .then(courseResult)
      .then((course) => {
        if (!controller.signal.aborted)
          dispatch({ type: "courseReceived", operationId, course });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          dispatch({
            type: "loadFailed",
            operationId,
            message:
              error instanceof Error
                ? error.message
                : "The saved course could not be loaded.",
          });
      });
    return () => controller.abort();
  }, [attempt, courseId]);

  if (state.phase === "ready")
    return <SavedCoursePreview course={state.course} />;
  return (
    <div className="mx-auto grid max-w-xl gap-4 p-6 sm:p-10">
      <Button asChild variant="outline">
        <Link to={`/courses/${courseId}`}>
          <ArrowLeft aria-hidden="true" />
          Back to course
        </Link>
      </Button>
      <h1 className="text-xl font-semibold">3D course preview</h1>
      <p role={state.phase === "failed" ? "alert" : "status"}>
        {state.phase === "failed" ? state.message : "Loading saved course."}
      </p>
      {state.phase === "failed" ? (
        <Button onClick={() => setAttempt((value) => value + 1)}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

function SavedCoursePreview({ course }: { course: Course }) {
  const sections = useMemo(() => coursePreviewSections(course), [course]);
  const [sectionIndex, setSectionIndex] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const section = sections[sectionIndex];
  return (
    <CoursePreviewStage
      key={`${sectionIndex}-${attempt}`}
      course={course}
      section={section}
      sections={sections}
      onSection={(index) => setSectionIndex(index)}
      onRetry={() => setAttempt((value) => value + 1)}
    />
  );
}

function CoursePreviewStage({
  course,
  section,
  sections,
  onSection,
  onRetry,
}: {
  course: Course;
  section: CoursePreviewSection;
  sections: CoursePreviewSection[];
  onSection: (index: number) => void;
  onRetry: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<GoogleRouteNavigatorEngine | undefined>(undefined);
  const stateRef = useRef(initialCoursePreviewSession());
  const [state, setState] = useState(stateRef.current);
  const motionRef = useRef<RouteCameraMotionState | undefined>(undefined);
  const reducedMotion = useReducedMotion();
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;
  const { control, status } = state;

  const renderPosition = useCallback(
    (
      force: boolean,
      elapsedSeconds = 1 / 60,
      movement: "tracking" | "transition" = "transition",
    ) => {
      const current = stateRef.current.control;
      const pose = coursePreviewCamera(
        section,
        current.progressM,
        current.cameraMode === "overview" ? "overview" : "chase",
      );
      const motion =
        force || !motionRef.current
          ? createRouteCameraMotionState(pose)
          : advanceRouteCameraMotion(
              motionRef.current,
              pose,
              elapsedSeconds,
              0.48,
              movement,
            );
      motionRef.current = motion;
      engineRef.current?.setFollowing(current.following);
      if (current.following) engineRef.current?.setCamera(motion.pose);
    },
    [section],
  );

  const renderThread = useCallback(() => {
    const current = stateRef.current.control;
    engineRef.current?.setCinematicRoute({
      startRatio: 0,
      endRatio: 1,
      focusRatio: current.progressM / section.distanceM,
      motionIntensity: 0.4,
      rangeM: 650,
      shotKind: "tracking",
    });
  }, [section.distanceM]);

  const commit = useCallback(
    (event: CoursePreviewSessionEvent) => {
      const previous = stateRef.current;
      const next = reduceCoursePreviewSession(previous, event);
      stateRef.current = next;
      setState(next);
      engineRef.current?.setFollowing(next.control.following);
      if (next.control.following && !previous.control.following) {
        const actual = engineRef.current?.readCamera();
        if (actual)
          motionRef.current = createRouteCameraMotionState({
            ...actual,
            progressM: next.control.progressM,
          });
      }
      const providerReady =
        event.type === "providerChanged" && event.status.state === "ready";
      const reposition =
        event.type === "controlRequested" &&
        ["progressSelected", "cameraSelected", "followingChanged"].includes(
          event.event.type,
        );
      if (next.control.following && (providerReady || reposition)) {
        renderPosition(providerReady || reducedMotionRef.current);
      }
      renderThread();
    },
    [renderPosition, renderThread],
  );
  const requestControl = (event: ReplaySessionEvent) =>
    commit({ type: "controlRequested", event });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const engine = createGoogleRouteNavigatorEngine();
    engineRef.current = engine;
    void engine.mount({
      apiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "",
      container,
      route: section,
      groundingMode: "ground",
      initialCamera: coursePreviewCamera(section, 0, "chase"),
      headingSmoothing: 1,
      routeStyle: {
        mode: "filament",
        palette: "immersive",
        color: "#f5f5f5",
        outerColor: "#111111",
        outerWidth: 0.14,
        width: 3,
      },
      onStatus: (next) => {
        if (engineRef.current === engine)
          commit({ type: "providerChanged", status: next });
      },
    });
    return () => {
      engineRef.current = undefined;
      engine.destroy();
    };
  }, [commit, section]);

  useEffect(() => {
    if (
      reducedMotion &&
      status.state === "ready" &&
      stateRef.current.control.following
    )
      renderPosition(true);
  }, [reducedMotion, renderPosition, status.state]);

  useEffect(() => {
    if (status.state !== "ready") return;
    let animationFrame = 0;
    let previous = performance.now();
    let lastUiUpdate = previous;
    let lastThreadUpdate = previous;
    const tick = (now: number) => {
      const elapsedSeconds = Math.min(0.1, (now - previous) / 1_000);
      previous = now;
      const before = stateRef.current;
      stateRef.current = reduceCoursePreviewSession(before, {
        type: "controlRequested",
        event: {
          type: "frameElapsed",
          elapsedSeconds,
          totalDistanceM: section.distanceM,
        },
      });
      const progressChanged =
        stateRef.current.control.progressM !== before.control.progressM;
      const cameraSettling =
        motionRef.current && !routeCameraMotionHasSettled(motionRef.current);
      if (
        stateRef.current.control.following &&
        (progressChanged || cameraSettling)
      ) {
        renderPosition(
          false,
          elapsedSeconds,
          progressChanged ? "tracking" : "transition",
        );
      }
      if (progressChanged) {
        if (now - lastThreadUpdate >= 40) {
          renderThread();
          lastThreadUpdate = now;
        }
        if (now - lastUiUpdate >= 90 || !stateRef.current.control.playing) {
          setState(stateRef.current);
          lastUiUpdate = now;
        }
      }
      animationFrame = requestAnimationFrame(tick);
    };
    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [renderPosition, renderThread, section.distanceM, status.state]);

  const togglePlayback = () => {
    if (control.progressM >= section.distanceM)
      requestControl({
        type: "progressSelected",
        progressM: 0,
        totalDistanceM: section.distanceM,
      });
    requestControl({ type: "playbackToggled" });
  };
  const releaseCamera = () => {
    if (stateRef.current.control.following)
      requestControl({ type: "followingChanged", following: false });
  };
  const ready = status.state === "ready";
  return (
    <section
      aria-label="3D course preview"
      className="immersive-replay fixed inset-0 z-[var(--z-map-controls)] overflow-hidden bg-canvas text-ink"
      data-testid="course-preview-stage"
      data-state={status.state}
      data-following={control.following}
      data-section={section.sectionNumber}
      data-engine="google-3d-maps"
    >
      <div
        ref={containerRef}
        className="absolute inset-0"
        aria-label={`Google photorealistic 3D view of ${course.name}`}
        onPointerDownCapture={releaseCamera}
        onWheelCapture={releaseCamera}
      />
      <header className="replay-header pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start gap-3 p-3 sm:p-6">
        <div className="pointer-events-auto flex min-w-0 items-start gap-3">
          <Button
            asChild
            size="icon"
            variant="outline"
            className="shrink-0 bg-[var(--surface-map-glass)]"
          >
            <Link to={`/courses/${course.id}`} aria-label="Back to course">
              <ArrowLeft aria-hidden="true" />
            </Link>
          </Button>
          <div className="min-w-0">
            <p className="text-xs text-ink-secondary">3D course preview</p>
            <h1 className="line-clamp-2 text-lg font-semibold sm:text-2xl">
              {course.name}
            </h1>
            <p className="mt-1 text-sm text-ink-secondary">
              {(course.distanceM / 1_000).toFixed(1)} km ·{" "}
              {course.ascentM === null
                ? "Ascent unavailable"
                : `${Math.round(course.ascentM)} m up`}{" "}
              · {course.activity}
            </p>
          </div>
        </div>
      </header>
      {!ready ? (
        <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center p-6">
          <div
            className="pointer-events-auto max-w-sm rounded-[var(--radius-panel)] border border-line bg-surface p-5 text-center"
            role={status.state === "unavailable" ? "alert" : "status"}
          >
            <h2 className="text-lg font-semibold">
              {status.state === "unavailable"
                ? "3D preview unavailable"
                : "Opening the 3D map"}
            </h2>
            <p className="mt-2 text-sm text-ink-secondary">{status.message}</p>
            {status.state === "unavailable" ? (
              <div className="mt-4 flex justify-center gap-2">
                <Button onClick={onRetry}>
                  <RotateCcw aria-hidden="true" />
                  Try again
                </Button>
                <Button asChild variant="outline">
                  <Link to={`/courses/${course.id}`}>Back to course</Link>
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      <CoursePreviewControls
        course={course}
        section={section}
        sections={sections}
        control={control}
        ready={ready}
        onSection={onSection}
        onControl={requestControl}
        onTogglePlayback={togglePlayback}
      />
    </section>
  );
}
