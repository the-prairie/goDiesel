import type { FinderIntent } from "@/domain/planning";

export function finderIntentFromSearchParams(params: URLSearchParams): FinderIntent | null {
  const place = params.get("place")?.trim() ?? "";
  if (!place) return null;
  const activity = params.get("activity") === "Ride" ? "Ride" : "Run";
  const distance = Number(params.get("distance"));
  const terrainValue = params.get("terrain");
  const terrain = ["road", "trail", "mixed", "mountain"].includes(terrainValue ?? "")
    ? terrainValue as FinderIntent["terrain"]
    : "any";
  return {
    place,
    activity,
    distanceKm: Number.isFinite(distance) && distance > 0 ? distance : 20,
    terrain,
    vibe: params.get("vibe")?.trim() ?? "",
  };
}

export function finderSearchParamsForIntent(
  intent: FinderIntent,
  candidateSlug?: string,
) {
  const params = new URLSearchParams({
    place: intent.place.trim(),
    activity: intent.activity,
    distance: String(intent.distanceKm),
  });
  if (intent.terrain !== "any") params.set("terrain", intent.terrain);
  if (intent.vibe.trim()) params.set("vibe", intent.vibe.trim());
  if (candidateSlug) params.set("candidate", candidateSlug);
  return params;
}
