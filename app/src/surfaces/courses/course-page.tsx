import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Compass, Download, Plus, Save } from "lucide-react";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { Disclosure } from "@/ui/disclosure";
import { FinderRouteMap } from "@/ui/planning-route-map";
import { PageTitle } from "@/ui/page-title";
import {
  courseGpx,
  type Course,
  type CourseActivity,
  type CourseRequest,
  type CourseSummary,
} from "@/domain/courses";
import {
  courseListResult,
  courseRequest,
  courseResult,
  courseReceipt,
  downloadGpx,
} from "@/data/course-client";
import { CourseForm } from "./course-form";
import {
  initialCourseWorkspace,
  reduceCourseWorkspace,
  type CourseOperation,
} from "./course-workspace-state";

export function CoursePage() {
  const { courseId } = useParams();
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(
    reduceCourseWorkspace,
    initialCourseWorkspace,
  );
  const [token, setToken] = useState("");
  const [connection, setConnection] = useState(0);
  const requestRef = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const busy = state.progress.status === "pending";
  function begin(operation: CourseOperation, courseId?: string) {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const id = ++sequence.current;
    dispatch({ type: "start", operation, id, courseId });
    return { id, controller };
  }
  useEffect(() => {
    const { id, controller } = begin("load", courseId);
    void (async () => {
      try {
        if (courseId) {
          const course = courseResult(
            await courseRequest(
              undefined,
              `?id=${encodeURIComponent(courseId)}`,
              controller.signal,
            ),
          );
          dispatch({ type: "loaded", id, course });
        } else {
          const page = courseListResult(
            await courseRequest(undefined, "", controller.signal),
          );
          dispatch({ type: "listed", id, page });
        }
      } catch (error) {
        if (!controller.signal.aborted)
          dispatch({ type: "failed", id, message: errorMessage(error) });
      }
    })();
    return () => controller.abort();
  }, [courseId, connection]);
  useEffect(() => () => requestRef.current?.abort(), []);
  async function loadMore() {
    if (!state.cursor) return;
    const { id, controller } = begin("listMore");
    try {
      const page = courseListResult(
        await courseRequest(
          undefined,
          `?cursor=${encodeURIComponent(state.cursor)}`,
          controller.signal,
        ),
      );
      dispatch({ type: "listed", id, page, append: true });
    } catch (error) {
      if (!controller.signal.aborted)
        dispatch({ type: "failed", id, message: errorMessage(error) });
    }
  }
  async function generate(request: CourseRequest) {
    const { id, controller } = begin("generate");
    try {
      const result = await courseRequest(
        { action: "generate", request },
        "",
        controller.signal,
      );
      dispatch({
        type: "previewed",
        id,
        course: courseResult(result),
        receipt: courseReceipt(result),
      });
    } catch (error) {
      if (!controller.signal.aborted)
        dispatch({ type: "failed", id, message: errorMessage(error) });
    }
  }
  async function importGpx(file: File, activity: CourseActivity) {
    const { id, controller } = begin("import");
    try {
      if (file.size > 5_000_000)
        throw new Error("Choose a GPX smaller than 5 MB.");
      if (!/\.gpx$/i.test(file.name))
        throw new Error("Choose a .gpx route file.");
      const gpx = await file.text();
      if (controller.signal.aborted) return;
      const course = courseResult(
        await courseRequest(
          { action: "import", gpx, filename: file.name, activity },
          "",
          controller.signal,
        ),
      );
      dispatch({ type: "previewed", id, course });
    } catch (error) {
      if (!controller.signal.aborted)
        dispatch({ type: "failed", id, message: errorMessage(error) });
    }
  }
  async function save() {
    if (state.view.kind !== "preview") return;
    const { id, controller } = begin("save");
    try {
      const course = courseResult(
        await courseRequest(
          {
            action: "save",
            course: state.view.course,
            receipt: state.view.receipt,
          },
          "",
          controller.signal,
        ),
      );
      if (controller.signal.aborted) return;
      dispatch({ type: "saved", id, course });
      navigate(`/courses/${course.id}`, { replace: true });
    } catch (error) {
      if (!controller.signal.aborted)
        dispatch({ type: "failed", id, message: errorMessage(error) });
    }
  }
  return (
    <section className="grid content-start gap-6 pb-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="ghost">
          <Link to={courseId ? "/courses" : "/routes"}>
            <ArrowLeft />
            {courseId ? "Your courses" : "Your collection"}
          </Link>
        </Button>
        {state.view.kind !== "empty" ? (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              dispatch({ type: "new" });
              navigate("/courses");
            }}
          >
            <Plus />
            New route
          </Button>
        ) : null}
      </div>
      {state.view.kind === "empty" ? (
        <PageTitle
          eyebrow="Route studio"
          title="Create a course"
          copy="Plan a loop or import a GPX. Preview it in 3D and take it to your watch."
        />
      ) : (
        <h1 className="sr-only">Route studio</h1>
      )}
      {busy ? (
        <div
          role="status"
          className="flex items-center justify-between gap-4 rounded-md border border-line bg-surface p-4"
        >
          <p className="text-sm">
            {state.progress.status === "pending"
              ? {
                  load: "Opening your courses…",
                  listMore: "Loading more courses…",
                  generate:
                    "Comparing loops and mapped features. This can take up to 45 seconds…",
                  import: "Reading your GPX…",
                  save: "Saving your course…",
                }[state.progress.operation]
              : ""}
          </p>
          <Button
            variant="ghost"
            onClick={() => {
              requestRef.current?.abort();
              dispatch({ type: "cancel" });
            }}
          >
            Cancel
          </Button>
        </div>
      ) : null}
      {state.progress.status === "failed" ? (
        <div
          role="alert"
          className="space-y-3 rounded-md border border-line p-4"
        >
          <p>{state.progress.message}</p>
          <Button
            variant="outline"
            onClick={() => setConnection((value) => value + 1)}
          >
            Reload workspace
          </Button>
        </div>
      ) : null}
      <div
        className={
          state.view.kind === "saved"
            ? "min-w-0"
            : "grid min-w-0 items-start gap-8 xl:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)]"
        }
      >
        {state.view.kind !== "saved" ? (
          <div
            className={
              state.view.kind === "empty"
                ? "min-w-0"
                : "order-2 min-w-0 xl:order-1"
            }
          >
            <CourseForm
              busy={busy}
              onGenerate={(request) => void generate(request)}
              onImport={(file, activity) => void importGpx(file, activity)}
            />
          </div>
        ) : null}
        {state.view.kind === "empty" ? (
          <SavedCourses
            courses={state.courses}
            hasMore={!!state.cursor}
            busy={busy}
            onLoadMore={() => void loadMore()}
          />
        ) : (
          <CoursePreview
            course={state.view.course}
            saved={state.view.kind === "saved"}
            busy={busy}
            onSave={() => void save()}
          />
        )}
      </div>
      <Disclosure title="Agent access & workspace connection">
        <div className="mt-3 max-w-2xl space-y-4 text-ink-secondary">
          <p>
            Agents use the same route workspace through{" "}
            <code>/api/courses</code>. The repository includes a CLI and request
            examples in <code>docs/route-studio.md</code>. An agent can generate
            or upload a course and return a link to open it here.
          </p>
          <p>
            On a hosted workspace, enter the owner token configured by your
            administrator. It stays in this tab's session storage.
          </p>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              requestRef.current?.abort();
              dispatch({ type: "credentialsChanged" });
              sessionStorage.setItem("godiesel.course-token", token.trim());
              setToken("");
              setConnection((value) => value + 1);
            }}
          >
            <Input
              type="password"
              aria-label="Workspace owner token"
              value={token}
              autoComplete="off"
              onChange={(e) => setToken(e.target.value)}
              className="flex-1"
            />
            <Button type="submit" variant="outline">
              Connect
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                requestRef.current?.abort();
                dispatch({ type: "credentialsChanged" });
                sessionStorage.removeItem("godiesel.course-token");
                setConnection((value) => value + 1);
              }}
            >
              Disconnect
            </Button>
          </form>
        </div>
      </Disclosure>
    </section>
  );
}

function SavedCourses({
  courses,
  hasMore,
  busy,
  onLoadMore,
}: {
  courses: CourseSummary[];
  hasMore: boolean;
  busy: boolean;
  onLoadMore: () => void;
}) {
  return (
    <section
      aria-label="Saved courses"
      className="min-w-0 border-t border-line pt-6 xl:border-t-0 xl:pt-0"
    >
      <h2 className="text-xl font-semibold">
        Your courses{" "}
        <span className="text-ink-secondary">
          {courses.length}
          {hasMore ? "+" : ""}
        </span>
      </h2>
      <p className="mt-1 text-sm text-ink-secondary">
        Imported and generated routes, separate from your completed activities.
      </p>
      {courses.length ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {courses.map((course) => (
            <Link
              key={course.id}
              to={`/courses/${course.id}`}
              className="grid min-w-0 gap-2 rounded-lg border border-line p-4 transition-colors hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-ring"
            >
              <span className="break-words font-semibold">{course.name}</span>
              <span className="text-sm text-ink-secondary">
                {course.activity} · {(course.distanceM / 1000).toFixed(2)} km ·{" "}
                {course.sourceKind === "gpx" ? "GPX import" : "Generated loop"}
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-ink-secondary">
          Save a preview to keep it here.
        </p>
      )}
      {hasMore ? (
        <Button
          className="mt-4"
          variant="outline"
          disabled={busy}
          onClick={onLoadMore}
        >
          Load more courses
        </Button>
      ) : null}
    </section>
  );
}

function CoursePreview({
  course,
  saved,
  busy,
  onSave,
}: {
  course: Course;
  saved: boolean;
  busy: boolean;
  onSave: () => void;
}) {
  const lines = useMemo(
    () =>
      course.segments.map((segment) =>
        segment.map((p) => [p.lng, p.lat] as [number, number]),
      ),
    [course],
  );
  return (
    <article
      className="order-1 min-w-0 space-y-4 xl:order-2"
      aria-label="Course preview"
    >
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-widest text-ink-secondary">
          {saved ? "Saved course" : "Preview · not saved"}
        </p>
        <h2 className="break-words text-2xl font-semibold">{course.name}</h2>
        <p className="text-sm text-ink-secondary">
          {course.activity} · {(course.distanceM / 1000).toFixed(2)} km ·{" "}
          {course.ascentM === null
            ? "Elevation unavailable"
            : `${Math.round(course.ascentM)} m ascent`}{" "}
          ·{" "}
          {course.segments.length === 1
            ? "1 section"
            : `${course.segments.length} separate sections`}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {saved ? (
          <Button asChild>
            <Link to={`/courses/${course.id}/preview`}>
              <Compass />
              Open 3D preview
            </Link>
          </Button>
        ) : (
          <Button onClick={onSave} disabled={busy}>
            <Save />
            Save course
          </Button>
        )}
        <Button
          variant="outline"
          onClick={() => downloadGpx(courseGpx(course), `${course.id}.gpx`)}
        >
          <Download />
          Download GPX
        </Button>
      </div>
      <div className="h-[min(52vh,28rem)] min-h-64 overflow-hidden rounded-lg border border-line">
        <FinderRouteMap lines={lines} selectedSlug={course.id} />
      </div>
      {course.assessment ? <CourseEvidence course={course} /> : null}
      {course.warnings.length ? (
        <ul className="list-disc space-y-1 pl-5 text-sm leading-6 text-ink-secondary">
          {course.warnings.map((warning, i) => (
            <li key={i}>{warning}</li>
          ))}
        </ul>
      ) : null}
      <Disclosure title="About this course">
        <p className="text-sm leading-6 text-ink-secondary">
          {course.description}
        </p>
      </Disclosure>
      <Disclosure title="Take this route to your Suunto Race S">
        <ol className="list-decimal space-y-2 pl-5 leading-6 text-ink-secondary">
          <li>Download the GPX on your phone.</li>
          <li>
            Open the Suunto app, go to the map, then import the GPX as a route.
            You can also share the file to Suunto.
          </li>
          <li>
            Save the route, enable it for your watch, and sync your Race S.
          </li>
        </ol>
        <p className="mt-3 leading-6 text-ink-secondary">
          This exports a navigation course. It does not upload an activity or
          send directly to the watch.
        </p>
        <a
          className="mt-2 inline-flex min-h-11 items-center underline"
          href="https://www.suunto.com/Support/faq-articles/suunto-app/what-files-can-i-import-to-the-suunto-app/"
          target="_blank"
          rel="noreferrer"
        >
          Suunto import instructions
        </a>
      </Disclosure>
      {course.source.kind === "generated" ? (
        <p className="text-xs text-ink-secondary">
          Routing by {course.source.provider === "ors" ? (
            <a href="https://openrouteservice.org/" target="_blank" rel="noreferrer" className="underline">openrouteservice by HeiGIT</a>
          ) : "BRouter"} using{" "}
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            OpenStreetMap contributors
          </a>
          . {course.source.provider === "ors" ? <><a className="underline" href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">Route result CC BY-SA 4.0</a>. </> : null}Check local access and conditions before setting out.
        </p>
      ) : null}
    </article>
  );
}
const evidenceLabels = { parks: "Parks", waterfront: "Near water", paved: "Paved surface", quietEstimate: "Quiet estimate", ascent: "Climbing" };
function CourseEvidence({ course }: { course: Course }) {
  const evidence = course.assessment!;
  const selection = evidence.selection;
  const formatDistance = (meters: number) => `${(meters / 1000).toFixed(1)} km`;
  return (
    <section aria-label="Route evidence" className="space-y-3 border-y border-line py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">Why this route</h3>
        <p className="text-xs text-ink-secondary">
          {selection ? `${selection.comparedCount} distinct usable ${selection.comparedCount === 1 ? "loop" : "loops"} found` : "Mapped route estimates"}
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        {(["parks", "waterfront", "paved", "quietEstimate"] as const).map((key) => {
          const metric = evidence[key];
          return <div key={key}>
            <dt className="text-xs text-ink-secondary">{evidenceLabels[key]}</dt>
            <dd className="mt-1 font-semibold">{metric.knownM > 0 ? formatDistance(metric.matchedM) : "Unknown"}</dd>
            <dd className="text-xs text-ink-secondary">{key === "quietEstimate" ? "on path-type ways" : key === "waterfront" ? "within 75 m" : key === "parks" ? "inside mapped parks" : "mapped as paved"}</dd>
          </div>;
        })}
      </dl>
      <Disclosure title="How we chose it">
        <div className="space-y-2 text-sm leading-6 text-ink-secondary">
          <p>Distance comes first. Loops within 10% of your target are preferred. We then compare your selected preferences using the same measurements for each route.</p>
          <p>{selection?.usedDimensions.length ? `Compared ${selection.usedDimensions.map((key) => evidenceLabels[key].toLowerCase()).join(", ")}.` : "There were not enough comparable alternatives to rank your preferences."}</p>
          {selection?.ignoredDimensions.length ? <p>Not used in selection: {selection.ignoredDimensions.map((key) => evidenceLabels[key].toLowerCase()).join(", ")}. Comparable coverage was insufficient.</p> : null}
          <p>Park and water distances are sampled estimates from mapped polygons and waterways. Near water does not guarantee a view or shoreline access. Quiet estimates favor paths, tracks, cycleways, footways and steps; they do not measure traffic or noise. Climbing uses the returned elevation samples.</p>
          <ul className="list-disc pl-5">
            {(["parks", "waterfront", "paved", "quietEstimate"] as const).map((key) => <li key={key}>{evidenceLabels[key]}: {formatDistance(evidence[key].knownM)} assessed, {formatDistance(evidence[key].unknownM)} unknown.</li>)}
          </ul>
          <p>Evidence is saved with this course. Missing map tags and later changes can affect these estimates.</p>
        </div>
      </Disclosure>
    </section>
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The request could not complete. Try again.";
}
