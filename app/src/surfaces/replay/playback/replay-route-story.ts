import sanFrancisco from "@/data/replay-stories/14736711660.json";
import type { QuestRoute } from "@/domain/route";

export interface ReplayStoryPlace {
  name: string;
  atDistanceM: number;
  latitude: number;
  longitude: number;
  sourceUrl: string;
}

export interface ReplayStoryChapter {
  id: string;
  startM: number;
  label: string;
  summary: string;
  places: ReplayStoryPlace[];
}

interface ReplayRouteStory {
  activityId: string;
  geometrySignature: string;
  reviewedAt: string;
  chapters: ReplayStoryChapter[];
}

const stories: ReplayRouteStory[] = [sanFrancisco];

export function replayRouteGeometrySignature(route: Pick<QuestRoute, "distanceKm" | "route" | "provenance">): string {
  const geometry = JSON.stringify([route.distanceKm, route.route.map(point => [point.lat, point.lng, point.d]),
    route.provenance.discontinuities.map(gap => [gap.startD, gap.endD])]);
  let hash = 2166136261;
  for (let index = 0; index < geometry.length; index++) {
    hash = Math.imul(hash ^ geometry.charCodeAt(index), 16777619);
  }
  return (hash >>> 0).toString(16);
}

export function replayRouteStory(route: QuestRoute): ReplayRouteStory | undefined {
  const story = stories.find(candidate => candidate.activityId === route.activityId);
  if (!story) return undefined;
  return story.geometrySignature === replayRouteGeometrySignature(route) ? story : undefined;
}
