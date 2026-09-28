export function kilometres(distanceM: number) {
  return `${(distanceM / 1_000).toFixed(2)} km`;
}

const comparable = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** "Footage", naming the clip only when it says something the heading does not. */
export function footageKind(clipTitle: string | undefined, heading: string) {
  return clipTitle && comparable(clipTitle) !== comparable(heading) ? `Footage · ${clipTitle}` : "Footage";
}
