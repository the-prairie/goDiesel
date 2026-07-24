import type { QuestRoute } from "@/domain/routes";
import { bearingDegrees, routeDistanceM, routePathPose } from "@/replay/route-path";

export type CinematicCut = "feature" | "monumental" | "kinetic" | "intimate";

export interface CinematicMoment {
  kind: "origin" | "summit" | "turn" | "climb" | "arrival";
  label: string;
  progressRatio: number;
  score: number;
}

export interface CinematicLook {
  bloom: number;
  contrast: number;
  depthOfField: number;
  exposure: number;
  fog: number;
  saturation: number;
  vignette: number;
}

export interface CinematicFrame {
  chapter: string;
  chapterProgress: number;
  cut: CinematicCut;
  cutPulse: number;
  elapsedSeconds: number;
  durationSeconds: number;
  headingDeg: number;
  lensMm: number;
  pitchDeg: number;
  progress: number;
  rangeM: number;
  routeProgressM: number;
  showDecision: boolean;
  showChapterTitle: boolean;
  shotCount: number;
  shotIndex: number;
  target: { lat: number; lng: number; elev: number };
  threadEndRatio: number;
  threadStartRatio: number;
  look: CinematicLook;
}

interface Shot {
  chapter: string;
  duration: number;
  fromProgress: number;
  toProgress: number;
  fromRangeM: number;
  toRangeM: number;
  fromPitchDeg: number;
  toPitchDeg: number;
  headingOffsetFrom: number;
  headingOffsetTo: number;
  lensFromMm: number;
  lensToMm: number;
  threadBehind: number;
  threadAhead: number;
  look: CinematicLook;
}

export const CINEMATIC_CUT_LABELS: Record<CinematicCut, string> = {
  feature: "Route Film",
  monumental: "Monumental",
  kinetic: "Kinetic",
  intimate: "Intimate",
};

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function easeInOutQuint(value: number) {
  const bounded = clamp(value);
  return bounded < 0.5
    ? 16 * bounded ** 5
    : 1 - (-2 * bounded + 2) ** 5 / 2;
}

function easeOutCubic(value: number) {
  return 1 - (1 - clamp(value)) ** 3;
}

function interpolate(start: number, end: number, amount: number) {
  return start + (end - start) * amount;
}

function interpolateHeading(start: number, end: number, amount: number) {
  const delta = ((end - start + 540) % 360) - 180;
  return (start + delta * amount + 360) % 360;
}

function smoothRouteTarget(
  route: QuestRoute,
  progressRatio: number,
  radiusM: number,
) {
  const totalDistanceM = routeDistanceM(route);
  const progressM = totalDistanceM * clamp(progressRatio);
  let lat = 0;
  let lng = 0;
  let elev = 0;
  let totalWeight = 0;
  for (let index = -4; index <= 4; index += 1) {
    const offsetRatio = index / 4;
    const pose = routePathPose(
      route,
      clamp(progressM + radiusM * offsetRatio, 0, totalDistanceM),
    );
    const weight = Math.cos((Math.abs(offsetRatio) * Math.PI) / 2) ** 2 + 0.05;
    lat += pose.lat * weight;
    lng += pose.lng * weight;
    elev += pose.elev * weight;
    totalWeight += weight;
  }
  return {
    lat: lat / totalWeight,
    lng: lng / totalWeight,
    elev: elev / totalWeight,
  };
}

function sampleBearing(
  route: QuestRoute,
  progressRatio: number,
  sampleDistanceM: number,
) {
  const totalDistanceM = routeDistanceM(route);
  const progressM = totalDistanceM * clamp(progressRatio);
  const smoothingRadiusM = Math.max(120, sampleDistanceM * 0.42);
  const from = smoothRouteTarget(
    route,
    Math.max(0, progressM - sampleDistanceM) / totalDistanceM,
    smoothingRadiusM,
  );
  const to = smoothRouteTarget(
    route,
    Math.min(totalDistanceM, progressM + sampleDistanceM) / totalDistanceM,
    smoothingRadiusM,
  );
  return bearingDegrees(
    { ...from, d: Math.max(0, progressM - sampleDistanceM) },
    { ...to, d: Math.min(totalDistanceM, progressM + sampleDistanceM) },
  );
}

export function cinematicMoments(route: QuestRoute): CinematicMoment[] {
  const points = route.route;
  const totalDistanceM = routeDistanceM(route);
  if (points.length < 3) {
    return [
      { kind: "origin", label: "Origin", progressRatio: 0, score: 1 },
      { kind: "arrival", label: "Arrival", progressRatio: 1, score: 1 },
    ];
  }

  let summit = points[0];
  let steepest = { point: points[1], score: Number.NEGATIVE_INFINITY };
  let sharpest = { point: points[1], score: Number.NEGATIVE_INFINITY };
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    const next = points[index + 1];
    if (point.elev > summit.elev) summit = point;

    const spanM = Math.max(1, next.d - previous.d);
    const grade = ((next.elev - previous.elev) / spanM) * 100;
    if (grade > steepest.score) steepest = { point, score: grade };

    const incoming = bearingDegrees(previous, point);
    const outgoing = bearingDegrees(point, next);
    const turn = Math.abs(((outgoing - incoming + 540) % 360) - 180);
    if (turn > sharpest.score) sharpest = { point, score: turn };
  }

  const ratio = (distanceM: number) => clamp(distanceM / totalDistanceM);
  return [
    { kind: "origin", label: "Origin", progressRatio: 0, score: 1 },
    {
      kind: "climb",
      label: "Hardest rise",
      progressRatio: ratio(steepest.point.d),
      score: Math.max(0, steepest.score),
    },
    {
      kind: "turn",
      label: "Sharpest turn",
      progressRatio: ratio(sharpest.point.d),
      score: sharpest.score,
    },
    {
      kind: "summit",
      label: "High point",
      progressRatio: ratio(summit.d),
      score: summit.elev,
    },
    { kind: "arrival", label: "Arrival", progressRatio: 1, score: 1 },
  ];
}

function looks(cut: CinematicCut): Record<string, CinematicLook> {
  const feature = {
    bloom: 0.1,
    contrast: 1.1,
    depthOfField: 0.08,
    exposure: 0.94,
    fog: 0.14,
    saturation: 0.9,
    vignette: 0.31,
  };
  const monumental = {
    bloom: 0.12,
    contrast: 1.08,
    depthOfField: 0,
    exposure: 0.96,
    fog: 0.12,
    saturation: 0.88,
    vignette: 0.28,
  };
  const kinetic = {
    bloom: 0.2,
    contrast: 1.14,
    depthOfField: 0,
    exposure: 1.02,
    fog: 0.04,
    saturation: 1.02,
    vignette: 0.2,
  };
  const intimate = {
    bloom: 0.08,
    contrast: 1.05,
    depthOfField: 0.16,
    exposure: 0.92,
    fog: 0.18,
    saturation: 0.84,
    vignette: 0.34,
  };
  return {
    feature,
    monumental,
    kinetic,
    intimate,
    active: { feature, monumental, kinetic, intimate }[cut],
  };
}

function shotPlan(route: QuestRoute, cut: CinematicCut): Shot[] {
  const totalDistanceM = routeDistanceM(route);
  const scale = clamp(totalDistanceM / 25_000, 0.72, 1.45);
  const moments = cinematicMoments(route);
  const summit = moments.find((moment) => moment.kind === "summit")?.progressRatio ?? 0.55;
  const turn = moments.find((moment) => moment.kind === "turn")?.progressRatio ?? 0.38;
  const climb = moments.find((moment) => moment.kind === "climb")?.progressRatio ?? 0.3;
  const activeLook = looks(cut).active;

  if (cut === "feature") {
    return [
      {
        chapter: "Somewhere on Earth",
        duration: 6.4,
        fromProgress: 0.5,
        toProgress: 0.48,
        fromRangeM: 21_000 * scale,
        toRangeM: 7_200 * scale,
        fromPitchDeg: -72,
        toPitchDeg: -52,
        headingOffsetFrom: -48,
        headingOffsetTo: -24,
        lensFromMm: 32,
        lensToMm: 40,
        threadBehind: 0,
        threadAhead: 0,
        look: activeLook,
      },
      {
        chapter: "A line reveals itself",
        duration: 6.2,
        fromProgress: 0.015,
        toProgress: 0.12,
        fromRangeM: 5_400 * scale,
        toRangeM: 2_600,
        fromPitchDeg: -48,
        toPitchDeg: -34,
        headingOffsetFrom: -21,
        headingOffsetTo: -8,
        lensFromMm: 38,
        lensToMm: 50,
        threadBehind: 0.012,
        threadAhead: 0.11,
        look: activeLook,
      },
      {
        chapter: "The day begins to ask",
        duration: 7.2,
        fromProgress: clamp(climb - 0.025),
        toProgress: clamp(climb + 0.025),
        fromRangeM: 1_750,
        toRangeM: 840,
        fromPitchDeg: -29,
        toPitchDeg: -18,
        headingOffsetFrom: -7,
        headingOffsetTo: 5,
        lensFromMm: 55,
        lensToMm: 72,
        threadBehind: 0.022,
        threadAhead: 0.065,
        look: activeLook,
      },
      {
        chapter: "At the high point",
        duration: 7.6,
        fromProgress: clamp(summit - 0.02),
        toProgress: clamp(summit + 0.02),
        fromRangeM: 1_150,
        toRangeM: 1_650,
        fromPitchDeg: -19,
        toPitchDeg: -29,
        headingOffsetFrom: 8,
        headingOffsetTo: -12,
        lensFromMm: 85,
        lensToMm: 60,
        threadBehind: 0.035,
        threadAhead: 0.055,
        look: activeLook,
      },
      {
        chapter: "The route remains",
        duration: 7,
        fromProgress: 0.94,
        toProgress: 1,
        fromRangeM: 1_300,
        toRangeM: 11_000 * scale,
        fromPitchDeg: -25,
        toPitchDeg: -62,
        headingOffsetFrom: -8,
        headingOffsetTo: 28,
        lensFromMm: 50,
        lensToMm: 28,
        threadBehind: 0.12,
        threadAhead: 0.01,
        look: activeLook,
      },
    ];
  }

  if (cut === "kinetic") {
    return [
      {
        chapter: "Ignition",
        duration: 3.2,
        fromProgress: 0.02,
        toProgress: 0.055,
        fromRangeM: 3_200 * scale,
        toRangeM: 1_250,
        fromPitchDeg: -46,
        toPitchDeg: -30,
        headingOffsetFrom: -28,
        headingOffsetTo: -8,
        lensFromMm: 35,
        lensToMm: 45,
        threadBehind: 0.015,
        threadAhead: 0.09,
        look: activeLook,
      },
      {
        chapter: "Acceleration",
        duration: 4.2,
        fromProgress: clamp(climb - 0.025),
        toProgress: clamp(climb + 0.025),
        fromRangeM: 1_050,
        toRangeM: 620,
        fromPitchDeg: -27,
        toPitchDeg: -19,
        headingOffsetFrom: -7,
        headingOffsetTo: 10,
        lensFromMm: 48,
        lensToMm: 58,
        threadBehind: 0.018,
        threadAhead: 0.055,
        look: activeLook,
      },
      {
        chapter: "The break",
        duration: 4.1,
        fromProgress: clamp(turn - 0.02),
        toProgress: clamp(turn + 0.02),
        fromRangeM: 720,
        toRangeM: 980,
        fromPitchDeg: -18,
        toPitchDeg: -31,
        headingOffsetFrom: 12,
        headingOffsetTo: -16,
        lensFromMm: 54,
        lensToMm: 42,
        threadBehind: 0.022,
        threadAhead: 0.07,
        look: activeLook,
      },
      {
        chapter: "Release",
        duration: 4.8,
        fromProgress: 0.94,
        toProgress: 1,
        fromRangeM: 1_100,
        toRangeM: 5_600 * scale,
        fromPitchDeg: -32,
        toPitchDeg: -58,
        headingOffsetFrom: -10,
        headingOffsetTo: 25,
        lensFromMm: 42,
        lensToMm: 30,
        threadBehind: 0.06,
        threadAhead: 0.03,
        look: activeLook,
      },
    ];
  }

  if (cut === "intimate") {
    return [
      {
        chapter: "Before the first step",
        duration: 5.2,
        fromProgress: 0.005,
        toProgress: 0.035,
        fromRangeM: 1_400,
        toRangeM: 520,
        fromPitchDeg: -38,
        toPitchDeg: -18,
        headingOffsetFrom: -18,
        headingOffsetTo: -4,
        lensFromMm: 42,
        lensToMm: 68,
        threadBehind: 0.005,
        threadAhead: 0.04,
        look: activeLook,
      },
      {
        chapter: "Inside the terrain",
        duration: 7.4,
        fromProgress: clamp(climb - 0.018),
        toProgress: clamp(climb + 0.018),
        fromRangeM: 480,
        toRangeM: 340,
        fromPitchDeg: -17,
        toPitchDeg: -12,
        headingOffsetFrom: -4,
        headingOffsetTo: 6,
        lensFromMm: 72,
        lensToMm: 86,
        threadBehind: 0.012,
        threadAhead: 0.032,
        look: activeLook,
      },
      {
        chapter: "What the day asks",
        duration: 7.2,
        fromProgress: clamp(summit - 0.018),
        toProgress: clamp(summit + 0.018),
        fromRangeM: 360,
        toRangeM: 610,
        fromPitchDeg: -13,
        toPitchDeg: -24,
        headingOffsetFrom: 7,
        headingOffsetTo: -8,
        lensFromMm: 82,
        lensToMm: 62,
        threadBehind: 0.014,
        threadAhead: 0.04,
        look: activeLook,
      },
      {
        chapter: "Remember the line",
        duration: 5.6,
        fromProgress: 0.95,
        toProgress: 1,
        fromRangeM: 720,
        toRangeM: 3_400 * scale,
        fromPitchDeg: -27,
        toPitchDeg: -50,
        headingOffsetFrom: -6,
        headingOffsetTo: 18,
        lensFromMm: 55,
        lensToMm: 34,
        threadBehind: 0.04,
        threadAhead: 0.02,
        look: activeLook,
      },
    ];
  }

  return [
    {
      chapter: "A place before a route",
      duration: 7,
      fromProgress: 0.48,
      toProgress: 0.46,
      fromRangeM: 15_000 * scale,
      toRangeM: 5_200 * scale,
      fromPitchDeg: -68,
      toPitchDeg: -48,
      headingOffsetFrom: -42,
      headingOffsetTo: -18,
      lensFromMm: 28,
      lensToMm: 40,
      threadBehind: 0,
      threadAhead: 0,
      look: activeLook,
    },
    {
      chapter: "The line appears",
      duration: 6.4,
      fromProgress: clamp(climb - 0.035),
      toProgress: clamp(climb + 0.035),
      fromRangeM: 4_800 * scale,
      toRangeM: 2_100,
      fromPitchDeg: -46,
      toPitchDeg: -31,
      headingOffsetFrom: -16,
      headingOffsetTo: -4,
      lensFromMm: 42,
      lensToMm: 55,
      threadBehind: 0.04,
      threadAhead: 0.12,
      look: activeLook,
    },
    {
      chapter: "The world becomes effort",
      duration: 8.2,
      fromProgress: clamp(summit - 0.025),
      toProgress: clamp(summit + 0.025),
      fromRangeM: 1_900,
      toRangeM: 1_050,
      fromPitchDeg: -30,
      toPitchDeg: -22,
      headingOffsetFrom: -3,
      headingOffsetTo: 9,
      lensFromMm: 58,
      lensToMm: 76,
      threadBehind: 0.025,
      threadAhead: 0.065,
      look: activeLook,
    },
    {
      chapter: "Would you take this line?",
      duration: 7.4,
      fromProgress: 0.93,
      toProgress: 1,
      fromRangeM: 1_200,
      toRangeM: 9_000 * scale,
      fromPitchDeg: -24,
      toPitchDeg: -58,
      headingOffsetFrom: 8,
      headingOffsetTo: 30,
      lensFromMm: 50,
      lensToMm: 30,
      threadBehind: 0.08,
      threadAhead: 0.01,
      look: activeLook,
    },
  ];
}

export function cinematicDuration(route: QuestRoute, cut: CinematicCut) {
  return shotPlan(route, cut).reduce((total, shot) => total + shot.duration, 0);
}

export function cinematicFrame(
  route: QuestRoute,
  cut: CinematicCut,
  elapsedSeconds: number,
): CinematicFrame {
  const shots = shotPlan(route, cut);
  const durationSeconds = shots.reduce((total, shot) => total + shot.duration, 0);
  const elapsed = clamp(elapsedSeconds, 0, durationSeconds);
  let shotStart = 0;
  let shot = shots[shots.length - 1];
  let shotIndex = shots.length - 1;
  for (const [index, candidate] of shots.entries()) {
    if (elapsed <= shotStart + candidate.duration) {
      shot = candidate;
      shotIndex = index;
      break;
    }
    shotStart += candidate.duration;
  }
  const local = clamp((elapsed - shotStart) / shot.duration);
  const eased = cut === "kinetic" ? easeOutCubic(local) : easeInOutQuint(local);
  const routeProgressRatio = interpolate(
    shot.fromProgress,
    shot.toProgress,
    eased,
  );
  const rangeM = interpolate(shot.fromRangeM, shot.toRangeM, eased);
  const pose = routePathPose(
    route,
    routeDistanceM(route) * clamp(routeProgressRatio),
  );
  const spatialRadiusM =
    cut === "monumental"
      ? clamp(rangeM * 0.16, 420, 2_400)
      : cut === "kinetic"
        ? clamp(rangeM * 0.22, 240, 900)
        : clamp(rangeM * 0.28, 180, 720);
  const target = smoothRouteTarget(route, routeProgressRatio, spatialRadiusM);
  const routeHeading = sampleBearing(
    route,
    routeProgressRatio,
    clamp(rangeM * 0.38, 320, 2_800),
  );
  const headingOffset = interpolateHeading(
    shot.headingOffsetFrom,
    shot.headingOffsetTo,
    eased,
  );
  const threadHidden = shot.threadBehind === 0 && shot.threadAhead === 0;

  return {
    chapter: shot.chapter,
    chapterProgress: local,
    cut,
    cutPulse:
      elapsed === 0
        ? 1
        : Math.max(
            clamp(1 - (elapsed - shotStart) / 0.26),
            clamp(1 - (shotStart + shot.duration - elapsed) / 0.16),
          ),
    elapsedSeconds: elapsed,
    durationSeconds,
    headingDeg: (routeHeading + headingOffset + 360) % 360,
    lensMm: interpolate(shot.lensFromMm, shot.lensToMm, eased),
    pitchDeg: interpolate(shot.fromPitchDeg, shot.toPitchDeg, eased),
    progress: elapsed / durationSeconds,
    rangeM,
    routeProgressM: pose.progressM,
    showDecision: elapsed >= durationSeconds - 1.1,
    showChapterTitle: local >= 0.08 && local <= 0.36,
    shotCount: shots.length,
    shotIndex,
    target,
    threadStartRatio: threadHidden
      ? 0
      : clamp(routeProgressRatio - shot.threadBehind),
    threadEndRatio: threadHidden
      ? 0
      : clamp(routeProgressRatio + shot.threadAhead),
    look: shot.look,
  };
}
