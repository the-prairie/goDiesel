import type {
  QuestRoute,
  RouteAnnotationEvidence,
  RouteAnnotationMedia,
} from "@/domain/route";
import { formatRouteDate } from "@/domain/route";

export interface RouteStoryChapter {
  id: string;
  kind: "start" | "annotation" | "summit" | "finish";
  title: string;
  body: string;
  evidence: RouteAnnotationEvidence;
  distanceM: number;
  elevationM?: number;
  media?: RouteAnnotationMedia;
}

export function routeStoryTitle(route: QuestRoute) {
  const activityTitle = route.activityName.trim();
  return /[a-z0-9]/i.test(activityTitle) ? activityTitle : route.name;
}

export function routeStoryPremise(route: QuestRoute) {
  return route.curation.vibe || route.description || route.completionRule;
}

export function routeStoryChapters(route: QuestRoute): RouteStoryChapter[] {
  const points = route.route;
  const start = points[0];
  const finish = points.at(-1);
  const totalDistanceM = Math.max(route.distanceKm * 1_000, finish?.d ?? 0);
  const isCompleted = route.lifecycle === "completed";
  const chapters: RouteStoryChapter[] = [];
  if (start) {
    chapters.push({
      id: "recorded-start",
      kind: "start",
      title: "The line begins",
      body: isCompleted
        ? `The recorded ${route.type.toLowerCase()} starts in ${route.region}${route.date ? ` on ${formatRouteDate(route.date)}` : ""}.`
        : `The imported ${route.type.toLowerCase()} route begins in ${route.region}${route.date ? ` on ${formatRouteDate(route.date)}` : ""}.`,
      evidence: "recorded",
      distanceM: 0,
      elevationM: route.elevationStatus !== "unavailable" ? start.elev : undefined,
    });
  }

  for (const annotation of [...route.annotations].sort(
    (left, right) => left.atDistanceM - right.atDistanceM,
  )) {
    chapters.push({
      id: annotation.id,
      kind: "annotation",
      title: annotation.title || annotationKindTitle(annotation.kind),
      body: annotation.body,
      evidence: annotation.evidence,
      distanceM: annotation.atDistanceM,
      elevationM: elevationAtDistance(route, annotation.atDistanceM),
      media: annotation.media,
    });
  }

  const summit = highestPoint(route);
  const summitIsEndpoint =
    !summit || summit.distanceM < 250 || totalDistanceM - summit.distanceM < 250;
  const summitHasNearbyChapter = chapters.some(
    (chapter) => Math.abs(chapter.distanceM - (summit?.distanceM ?? 0)) < 250,
  );
  if (summit && !summitIsEndpoint && !summitHasNearbyChapter) {
    chapters.push({
      id: "derived-high-point",
      kind: "summit",
      title: "The recorded high point",
      body: `The track reaches ${Math.round(summit.elevationM).toLocaleString()} m at ${distanceLabel(summit.distanceM)}.`,
      evidence: "derived",
      distanceM: summit.distanceM,
      elevationM: summit.elevationM,
    });
  }

  if (finish) {
    chapters.push({
      id: "recorded-finish",
      kind: "finish",
      title: "The recording closes",
      body: route.elevationStatus === "unavailable"
        ? `${isCompleted ? "The activity" : "The imported route"} closes after ${route.distanceKm.toFixed(1)} km. Elevation is unavailable.`
        : isCompleted
          ? `The activity ends after ${route.distanceKm.toFixed(1)} km and ${route.elevationGainM.toLocaleString()} m of recorded climbing.`
          : `The imported route closes after ${route.distanceKm.toFixed(1)} km and ${route.elevationGainM.toLocaleString()} m of source-recorded climbing.`,
      evidence: "recorded",
      distanceM: totalDistanceM,
      elevationM: route.elevationStatus === "recorded" ? finish.elev : undefined,
    });
  }

  return chapters.sort((left, right) => left.distanceM - right.distanceM);
}

export function highestPoint(route: QuestRoute) {
  if (route.route.length === 0 || route.elevationStatus === "unavailable") return undefined;
  const point = route.route.reduce((highest, candidate) =>
    candidate.elev > highest.elev ? candidate : highest,
  );
  return { distanceM: point.d, elevationM: point.elev };
}

export function elevationAtDistance(route: QuestRoute, distanceM: number) {
  if (route.route.length === 0 || route.elevationStatus === "unavailable") return undefined;
  return route.route.reduce((closest, point) =>
    Math.abs(point.d - distanceM) < Math.abs(closest.d - distanceM) ? point : closest,
  ).elev;
}

export function distanceLabel(distanceM: number) {
  return distanceM < 1_000
    ? `${Math.round(distanceM)} m`
    : `${(distanceM / 1_000).toFixed(1)} km`;
}

function annotationKindTitle(kind: QuestRoute["annotations"][number]["kind"]) {
  if (kind === "warning") return "Watch this section";
  if (kind === "landmark") return "A recorded landmark";
  if (kind === "image") return "A photographed moment";
  return "Field note";
}
