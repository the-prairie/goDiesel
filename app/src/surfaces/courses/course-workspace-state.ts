import {
  courseSummary,
  type Course,
  type CoursePage,
  type CourseSummary,
} from "@/domain/courses";

type View =
  | { kind: "empty" }
  | { kind: "preview"; course: Course; receipt?: string }
  | { kind: "saved"; course: Course };
export type CourseOperation =
  "load" | "listMore" | "generate" | "import" | "save";
type Progress =
  | { status: "idle" }
  | { status: "pending"; id: number; operation: CourseOperation }
  | { status: "failed"; message: string };
export type CourseWorkspace = {
  view: View;
  courses: CourseSummary[];
  cursor?: string;
  progress: Progress;
};
export const initialCourseWorkspace: CourseWorkspace = {
  view: { kind: "empty" },
  courses: [],
  progress: { status: "idle" },
};
export type CourseEvent =
  | { type: "start"; id: number; operation: CourseOperation; courseId?: string }
  | { type: "loaded"; id: number; course: Course }
  | { type: "listed"; id: number; page: CoursePage; append?: boolean }
  | { type: "previewed"; id: number; course: Course; receipt?: string }
  | { type: "saved"; id: number; course: Course }
  | { type: "failed"; id: number; message: string }
  | { type: "credentialsChanged" }
  | { type: "cancel" }
  | { type: "new" };
export function reduceCourseWorkspace(
  state: CourseWorkspace,
  event: CourseEvent,
): CourseWorkspace {
  if (event.type === "credentialsChanged") return initialCourseWorkspace;
  if (event.type === "new")
    return { ...state, view: { kind: "empty" }, progress: { status: "idle" } };
  if (event.type === "cancel")
    return { ...state, progress: { status: "idle" } };
  if (event.type === "start")
    return {
      ...state,
      view:
        event.operation === "load" &&
        !(
          state.view.kind === "saved" && state.view.course.id === event.courseId
        )
          ? { kind: "empty" }
          : state.view,
      progress: { status: "pending", id: event.id, operation: event.operation },
    };
  if (state.progress.status !== "pending" || state.progress.id !== event.id)
    return state;
  if (event.type === "failed")
    return { ...state, progress: { status: "failed", message: event.message } };
  if (event.type === "loaded")
    return {
      ...state,
      progress: { status: "idle" },
      view: { kind: "saved", course: event.course },
    };
  if (event.type === "listed") {
    const existing = event.append ? state.courses : [];
    return {
      ...state,
      courses: [
        ...existing,
        ...event.page.courses.filter(
          (course) => !existing.some((saved) => saved.id === course.id),
        ),
      ],
      cursor: event.page.cursor,
      progress: { status: "idle" },
    };
  }
  return {
    ...state,
    courses:
      event.type === "saved"
        ? [
            courseSummary(event.course),
            ...state.courses.filter((c) => c.id !== event.course.id),
          ]
        : state.courses,
    view:
      event.type === "saved"
        ? { kind: "saved", course: event.course }
        : {
            kind: "preview",
            course: event.course,
            ...(event.receipt ? { receipt: event.receipt } : {}),
          },
    progress: { status: "idle" },
  };
}
