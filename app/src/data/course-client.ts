import {
  parseCourse,
  parseCoursePage,
  type Course,
  type CoursePage,
} from "@/domain/courses";

export async function courseRequest(
  body?: unknown,
  query = "",
  signal?: AbortSignal,
): Promise<unknown> {
  const token = sessionStorage.getItem("godiesel.course-token");
  const response = await fetch(`/api/courses${query}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      typeof data.error === "string"
        ? data.error
        : "The route workspace could not complete this request.",
    );
  return data;
}
export function courseResult(data: unknown): Course {
  if (!data || typeof data !== "object" || !("course" in data))
    throw new Error("The server returned no course.");
  return parseCourse(data.course);
}
export function courseReceipt(data: unknown): string {
  if (
    !data ||
    typeof data !== "object" ||
    !("receipt" in data) ||
    typeof data.receipt !== "string" ||
    !data.receipt
  )
    throw new Error(
      "The routing service returned no verification receipt. Generate the route again.",
    );
  return data.receipt;
}
export function courseListResult(data: unknown): CoursePage {
  return parseCoursePage(data);
}
export function downloadGpx(xml: string, filename: string) {
  const url = URL.createObjectURL(
    new Blob([xml], { type: "application/gpx+xml" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
