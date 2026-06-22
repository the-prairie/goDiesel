export type RouteLifecycle = "completed" | "planned" | "discovered";

export function normalizeRouteLifecycle(value: unknown): RouteLifecycle {
  if (value === "planned" || value === "discovered") return value;
  return "completed";
}

export function isCompletedRoute(value: { lifecycle: RouteLifecycle }) {
  return value.lifecycle === "completed";
}
