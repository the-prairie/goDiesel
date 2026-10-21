import type { Course } from "@/domain/courses";

type View =
  | { kind: "empty" }
  | { kind: "preview"; course: Course; receipt?: string }
  | { kind: "saved"; course: Course };
type Operation = "load" | "generate" | "import" | "save";
type Progress =
  | { status: "idle" }
  | { status: "pending"; id: number; operation: Operation }
  | { status: "failed"; message: string };
export type CourseWorkspace = {
  view: View;
  courses: Course[];
  progress: Progress;
};
export const initialCourseWorkspace: CourseWorkspace = {
  view: { kind: "empty" },
  courses: [],
  progress: { status: "idle" },
};
export type CourseEvent =
  | { type: "start"; id: number; operation: Operation }
  | { type: "loaded"; id: number; courses: Course[]; course?: Course }
  | { type: "previewed"; id: number; course: Course; receipt?: string }
  | { type: "saved"; id: number; course: Course }
  | { type: "failed"; id: number; message: string }
  | { type: "cancel" }
  | { type: "new" };
export function reduceCourseWorkspace(
  state: CourseWorkspace,
  event: CourseEvent,
): CourseWorkspace {
  if (event.type === "new")
    return { ...state, view: { kind: "empty" }, progress: { status: "idle" } };
  if (event.type === "cancel")
    return { ...state, progress: { status: "idle" } };
  if (event.type === "start")
    return {
      ...state,
      view: event.operation === "load" ? { kind: "empty" } : state.view,
      progress: { status: "pending", id: event.id, operation: event.operation },
    };
  if (state.progress.status !== "pending" || state.progress.id !== event.id)
    return state;
  if (event.type === "failed")
    return { ...state, progress: { status: "failed", message: event.message } };
  if (event.type === "loaded")
    return {
      courses: event.courses,
      progress: { status: "idle" },
      view: event.course
        ? { kind: "saved", course: event.course }
        : { kind: "empty" },
    };
  return {
    courses:
      event.type === "saved"
        ? [
            event.course,
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
