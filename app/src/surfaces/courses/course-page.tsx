import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Check, Download, Plus, Save } from "lucide-react";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { FinderRouteMap } from "@/ui/planning-route-map";
import { PageTitle } from "@/ui/page-title";
import {
  courseGpx,
  type Course,
  type CourseActivity,
  type CourseRequest,
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
  function begin(operation: "load" | "generate" | "import" | "save") {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const id = ++sequence.current;
    dispatch({ type: "start", operation, id });
    return { id, controller };
  }
  useEffect(() => {
    const { id, controller } = begin("load");
    void (async () => {
      try {
        const courses = courseListResult(
          await courseRequest(undefined, "", controller.signal),
        );
        const course = courseId
          ? courseResult(
              await courseRequest(
                undefined,
                `?id=${encodeURIComponent(courseId)}`,
                controller.signal,
              ),
            )
          : undefined;
        dispatch({ type: "loaded", id, courses, course });
      } catch (error) {
        if (!controller.signal.aborted)
          dispatch({ type: "failed", id, message: errorMessage(error) });
      }
    })();
    return () => controller.abort();
  }, [courseId, connection]);
  useEffect(() => () => requestRef.current?.abort(), []);
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
          <Link to="/routes">
            <ArrowLeft />
            Your collection
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
          title="Make the next outing yours."
          copy="Plan a loop or bring a GPX. Preview the path, save your course, and take it to your watch."
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
                  generate:
                    "Finding a loop on real mapped paths. This can take up to a minute…",
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
      <div className="grid min-w-0 items-start gap-8 xl:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)]">
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
        {state.view.kind === "empty" ? (
          <div className="grid min-h-72 content-center gap-3 rounded-lg border border-line bg-surface p-6 sm:p-10">
            <p className="text-xs uppercase tracking-widest text-ink-secondary">
              Your route, your starting point
            </p>
            <h2 className="text-2xl font-semibold">
              A course for the day you have in mind.
            </h2>
            <p className="max-w-lg text-sm leading-6 text-ink-secondary">
              Choose a place, a distance, and a few preferences. You will see
              the mapped path and its actual distance before adding it to your
              courses.
            </p>
            <p className="text-sm text-ink-secondary">
              Already have a route from an agent or another app? Import its GPX.
            </p>
          </div>
        ) : (
          <CoursePreview
            course={state.view.course}
            saved={state.view.kind === "saved"}
            busy={busy}
            onSave={() => void save()}
          />
        )}
      </div>
      <section
        aria-label="Saved courses"
        className="mt-3 border-t border-line pt-6"
      >
        <h2 className="text-xl font-semibold">
          Your courses{" "}
          <span className="text-ink-secondary">{state.courses.length}</span>
        </h2>
        <p className="mt-1 text-sm text-ink-secondary">
          Imported and generated routes, separate from your completed
          activities.
        </p>
        {state.courses.length ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {state.courses.map((course) => (
              <Link
                key={course.id}
                to={`/courses/${course.id}`}
                className="grid min-w-0 gap-2 rounded-lg border border-line p-4 transition-colors hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-ring"
              >
                <span className="break-words font-semibold">{course.name}</span>
                <span className="text-sm text-ink-secondary">
                  {course.activity} · {(course.distanceM / 1000).toFixed(2)} km
                  ·{" "}
                  {course.source.kind === "gpx"
                    ? "GPX import"
                    : "Generated loop"}
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-ink-secondary">
            Save a preview to keep it here.
          </p>
        )}
      </section>
      <details className="border-t border-line pt-4 text-sm">
        <summary className="min-h-11 cursor-pointer py-3 font-medium">
          Agent access & workspace connection
        </summary>
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
                sessionStorage.removeItem("godiesel.course-token");
                setConnection((value) => value + 1);
              }}
            >
              Disconnect
            </Button>
          </form>
        </div>
      </details>
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
      <div className="h-80 overflow-hidden rounded-lg border border-line sm:h-[28rem]">
        <FinderRouteMap lines={lines} selectedSlug={course.id} />
      </div>
      <p className="text-sm leading-6 text-ink-secondary">
        {course.description}
      </p>
      {course.warnings.length ? (
        <ul className="list-disc space-y-1 pl-5 text-sm leading-6 text-ink-secondary">
          {course.warnings.map((warning, i) => (
            <li key={i}>{warning}</li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {saved ? (
          <span className="inline-flex min-h-11 items-center gap-2 px-3 text-sm">
            <Check className="size-4" />
            Saved
          </span>
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
      <details className="border-t border-line pt-2 text-sm">
        <summary className="min-h-11 cursor-pointer py-3 font-medium">
          Take this route to your Suunto Race S
        </summary>
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
      </details>
      {course.source.kind === "generated" ? (
        <p className="text-xs text-ink-secondary">
          Routing by BRouter using{" "}
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            OpenStreetMap contributors
          </a>
          . Check local access and conditions before setting out.
        </p>
      ) : null}
    </article>
  );
}
function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The request could not complete. Try again.";
}
