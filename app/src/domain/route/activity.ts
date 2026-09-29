// Activity types. Run and Ride are recorded activities; Hike covers on-foot
// routes that are not runs, such as a supplied trail line. Unknown types keep
// the historical run default so no existing route changes meaning.

export type ActivityNoun = "run" | "ride" | "hike";

export function activityNoun(type: string | undefined): ActivityNoun {
  if (type === "Ride") return "ride";
  if (type === "Hike") return "hike";
  return "run";
}

export function isOnFoot(type: string | undefined) {
  return activityNoun(type) !== "ride";
}
