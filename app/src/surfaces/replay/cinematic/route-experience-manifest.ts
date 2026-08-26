import type { QuestRoute } from "@/domain/route";
import {
  cinematicMoments,
  cinematicProfile,
  cinematicShotTimeline,
  cinematicTurningIntensity,
  cinematicVisualMoments,
  type CinematicCut,
} from "@/surfaces/replay/cinematic/route-cinematic-director";
import routeExperienceVersion from "@/surfaces/replay/cinematic/route-experience-version.json";

export const ROUTE_EXPERIENCE_ANALYSIS_VERSION = routeExperienceVersion.manifestVersion;
export const ROUTE_EXPERIENCE_DIRECTOR_VERSION = routeExperienceVersion.directorVersion;

export function routeExperienceManifest(route: QuestRoute) {
  const elevationAvailable = route.provenance?.elevation?.status !== "unavailable";
  const routeFingerprint = fingerprint(
    route.route.map((point) => [
      round(point.lat, 7), round(point.lng, 7), elevationAvailable ? round(point.elev, 2) : null, round(point.d, 2),
    ]),
  );
  const turningIntensityDeg = cinematicTurningIntensity(route);
  const recordedProfile = elevationAvailable ? cinematicProfile(route) : null;
  const profile = recordedProfile ?? {
    character: "unknown" as const,
    maximumElevationM: null,
    maximumGradePct: null,
    minimumElevationM: null,
    positiveGainM: null,
    reliefM: null,
    turningIntensityDeg,
  };
  const moments = elevationAvailable ? cinematicMoments(route) : [];
  const visualMoments = elevationAvailable ? cinematicVisualMoments(route) : [];
  const recommendedCut: CinematicCut =
    !elevationAvailable
      ? turningIntensityDeg > 95 ? "kinetic" : "feature"
        : recordedProfile!.character === "mountain"
        ? "monumental"
        : turningIntensityDeg > 95
        ? "kinetic"
        : recordedProfile!.reliefM < 80
          ? "intimate"
          : "feature";
  const reasons = [
    elevationAvailable ? `${recordedProfile!.character} route profile` : "route shape from recorded geometry",
    elevationAvailable
      ? recordedProfile!.reliefM >= 180 ? "substantial recorded relief" : "restrained recorded relief"
      : "elevation unavailable in the source",
    turningIntensityDeg > 95 ? "high turning intensity" : "legible route direction",
  ];
  const turn = moments.find((moment) => moment.kind === "turn");
  const climb = moments.find((moment) => moment.kind === "climb");
  const summit = moments.find((moment) => moment.kind === "summit");
  const visualHero = visualMoments[0];
  const terrainMoment = bestMoment([visualHero, summit, climb], 0.55);
  const lineMoment = bestMoment([turn, climb], 0.28);
  const teaserTimeline = [
    { chapter: "the-place", startSeconds: 0, endSeconds: 3.6, progressRatio: 0 },
    { chapter: "the-line", startSeconds: 3.6, endSeconds: 7.4, progressRatio: lineMoment },
    { chapter: "the-terrain", startSeconds: 7.4, endSeconds: 13.4, progressRatio: terrainMoment },
    { chapter: "the-decision", startSeconds: 13.4, endSeconds: 17.5, progressRatio: 1 },
  ] as const;
  const featureTimeline = elevationAvailable ? cinematicShotTimeline(route, recommendedCut) : [];
  const selectedMeaningfulMoments = [...moments, ...visualMoments]
    .sort((first, second) => second.score - first.score)
    .slice(0, 6)
    .map((moment) => ({
      kind: moment.kind,
      progressRatio: round(moment.progressRatio, 6),
      score: round(moment.score, 4),
    }));
  const renderFingerprint = fingerprint({
    analysisVersion: ROUTE_EXPERIENCE_ANALYSIS_VERSION,
    directorVersion: ROUTE_EXPERIENCE_DIRECTOR_VERSION,
    elevationStatus: route.provenance?.elevation?.status ?? "legacy",
    featureTimeline,
    recommendedCut,
    routeFingerprint,
    teaserTimeline,
  });
  return {
    routeFingerprint,
    analysisVersion: ROUTE_EXPERIENCE_ANALYSIS_VERSION,
    directorVersion: ROUTE_EXPERIENCE_DIRECTOR_VERSION,
    routeProfile: profile,
    selectedMeaningfulMoments,
    recommendedCinematicCut: recommendedCut,
    recommendationReasons: reasons,
    teaserTimeline,
    featureTimeline,
    renderFingerprint,
  } as const;
}

function bestMoment(
  moments: Array<{ progressRatio: number } | undefined>,
  fallback: number,
) {
  return round(moments.find(Boolean)?.progressRatio ?? fallback, 6);
}

function fingerprint(value: unknown) {
  const input = JSON.stringify(value);
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

function round(value: number, precision: number) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}
