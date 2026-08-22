import type { RouteLifecycle } from "@/domain/route";

export function studioExperienceLanguage(
  lifecycle: RouteLifecycle,
  temporalStatus: "recorded" | "unavailable",
) {
  const completed = lifecycle === "completed";
  return {
    noun: completed ? "Replay" : "Preview",
    action: completed ? "Replay" : "Explore",
    film: "Route film",
    timing:
      completed && temporalStatus === "recorded"
        ? "Owner-recorded timing"
        : "Cinematic timing",
  } as const;
}
