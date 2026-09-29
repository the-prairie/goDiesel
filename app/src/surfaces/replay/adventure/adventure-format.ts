export function kilometres(distanceM: number) {
  return `${(distanceM / 1_000).toFixed(2)} km`;
}

const comparable = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * What a clip is. The owner's footage is "Footage", naming the clip only when
 * it says something the heading does not; a rendered flyover is named as one,
 * with its credit, and never called footage.
 */
export function footageKind(
  clip: { title?: string; origin?: "recorded" | "rendered"; credit?: string } | undefined,
  heading: string,
) {
  if (clip?.origin === "rendered") return `Rendered flyover · ${clip.credit}`;
  return clip?.title && comparable(clip.title) !== comparable(heading) ? `Footage · ${clip.title}` : "Footage";
}
