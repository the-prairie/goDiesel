import type { QuestRoute } from "@/domain/routes";
import { bearingDegrees, routeDistanceM, routePathPose } from "@/replay/route-path";

export type CinematicCut = "monumental" | "kinetic" | "intimate";

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
  cut: CinematicCut;
  elapsedSeconds: number;
  durationSeconds: number;
  headingDeg: number;
  pitchDeg: number;
  progress: number;
  rangeM: number;
  routeProgressM: number;
  showDecision: boolean;
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
  threadBehind: number;
  threadAhead: number;
  look: CinematicLook;
}

export const CINEMATIC_CUT_LABELS: Record<CinematicCut, string> = {
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

function sampleBearing(route: QuestRoute, progressRatio: number) {
  const totalDistanceM = routeDistanceM(route);
  const progressM = totalDistanceM * clamp(progressRatio);
  const from = routePathPose(route, Math.max(0, progressM - 120));
  const to = routePathPose(route, Math.min(totalDistanceM, progressM + 120));
  return bearingDegrees(
    { ...from, d: from.progressM },
    { ...to, d: to.progressM },
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
  return { monumental, kinetic, intimate, active: { monumental, kinetic, intimate }[cut] };
}

function shotPlan(route: QuestRoute, cut: CinematicCut): Shot[] {
  const totalDistanceM = routeDistanceM(route);
  const scale = clamp(totalDistanceM / 25_000, 0.72, 1.45);
  const moments = cinematicMoments(route);
  const summit = moments.find((moment) => moment.kind === "summit")?.progressRatio ?? 0.55;
  const turn = moments.find((moment) => moment.kind === "turn")?.progressRatio ?? 0.38;
  const climb = moments.find((moment) => moment.kind === "climb")?.progressRatio ?? 0.3;
  const activeLook = looks(cut).active;

  if (cut === "kinetic") {
    return [
      {
        chapter: "Ignition",
        duration: 3.2,
        fromProgress: 0.02,
        toProgress: Math.max(0.12, climb - 0.04),
        fromRangeM: 3_200 * scale,
        toRangeM: 1_250,
        fromPitchDeg: -46,
        toPitchDeg: -30,
        headingOffsetFrom: -28,
        headingOffsetTo: -8,
        threadBehind: 0.015,
        threadAhead: 0.09,
        look: activeLook,
      },
      {
        chapter: "Acceleration",
        duration: 4.2,
        fromProgress: Math.max(0.1, climb - 0.04),
        toProgress: turn,
        fromRangeM: 1_050,
        toRangeM: 620,
        fromPitchDeg: -27,
        toPitchDeg: -19,
        headingOffsetFrom: -7,
        headingOffsetTo: 10,
        threadBehind: 0.018,
        threadAhead: 0.055,
        look: activeLook,
      },
      {
        chapter: "The break",
        duration: 4.1,
        fromProgress: turn,
        toProgress: Math.max(turn + 0.12, summit),
        fromRangeM: 720,
        toRangeM: 980,
        fromPitchDeg: -18,
        toPitchDeg: -31,
        headingOffsetFrom: 12,
        headingOffsetTo: -16,
        threadBehind: 0.022,
        threadAhead: 0.07,
        look: activeLook,
      },
      {
        chapter: "Release",
        duration: 4.8,
        fromProgress: Math.max(turn + 0.12, summit),
        toProgress: 1,
        fromRangeM: 1_100,
        toRangeM: 5_600 * scale,
        fromPitchDeg: -32,
        toPitchDeg: -58,
        headingOffsetFrom: -10,
        headingOffsetTo: 25,
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
        fromProgress: 0,
        toProgress: 0.08,
        fromRangeM: 1_400,
        toRangeM: 520,
        fromPitchDeg: -38,
        toPitchDeg: -18,
        headingOffsetFrom: -18,
        headingOffsetTo: -4,
        threadBehind: 0.005,
        threadAhead: 0.04,
        look: activeLook,
      },
      {
        chapter: "Inside the terrain",
        duration: 7.4,
        fromProgress: 0.08,
        toProgress: Math.max(0.46, climb),
        fromRangeM: 480,
        toRangeM: 340,
        fromPitchDeg: -17,
        toPitchDeg: -12,
        headingOffsetFrom: -4,
        headingOffsetTo: 6,
        threadBehind: 0.012,
        threadAhead: 0.032,
        look: activeLook,
      },
      {
        chapter: "What the day asks",
        duration: 7.2,
        fromProgress: Math.max(0.46, climb),
        toProgress: Math.max(0.72, summit),
        fromRangeM: 360,
        toRangeM: 610,
        fromPitchDeg: -13,
        toPitchDeg: -24,
        headingOffsetFrom: 7,
        headingOffsetTo: -8,
        threadBehind: 0.014,
        threadAhead: 0.04,
        look: activeLook,
      },
      {
        chapter: "Remember the line",
        duration: 5.6,
        fromProgress: Math.max(0.72, summit),
        toProgress: 1,
        fromRangeM: 720,
        toRangeM: 3_400 * scale,
        fromPitchDeg: -27,
        toPitchDeg: -50,
        headingOffsetFrom: -6,
        headingOffsetTo: 18,
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
      toProgress: 0.2,
      fromRangeM: 15_000 * scale,
      toRangeM: 5_200 * scale,
      fromPitchDeg: -68,
      toPitchDeg: -48,
      headingOffsetFrom: -42,
      headingOffsetTo: -18,
      threadBehind: 0,
      threadAhead: 0,
      look: activeLook,
    },
    {
      chapter: "The line appears",
      duration: 6.4,
      fromProgress: 0.2,
      toProgress: Math.max(0.36, climb),
      fromRangeM: 4_800 * scale,
      toRangeM: 2_100,
      fromPitchDeg: -46,
      toPitchDeg: -31,
      headingOffsetFrom: -16,
      headingOffsetTo: -4,
      threadBehind: 0.04,
      threadAhead: 0.12,
      look: activeLook,
    },
    {
      chapter: "The world becomes effort",
      duration: 8.2,
      fromProgress: Math.max(0.36, climb),
      toProgress: Math.max(0.7, summit),
      fromRangeM: 1_900,
      toRangeM: 1_050,
      fromPitchDeg: -30,
      toPitchDeg: -22,
      headingOffsetFrom: -3,
      headingOffsetTo: 9,
      threadBehind: 0.025,
      threadAhead: 0.065,
      look: activeLook,
    },
    {
      chapter: "Would you take this line?",
      duration: 7.4,
      fromProgress: Math.max(0.7, summit),
      toProgress: 1,
      fromRangeM: 1_200,
      toRangeM: 9_000 * scale,
      fromPitchDeg: -24,
      toPitchDeg: -58,
      headingOffsetFrom: 8,
      headingOffsetTo: 30,
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
  for (const candidate of shots) {
    if (elapsed <= shotStart + candidate.duration) {
      shot = candidate;
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
  const pose = routePathPose(
    route,
    routeDistanceM(route) * clamp(routeProgressRatio),
  );
  const routeHeading = sampleBearing(route, routeProgressRatio);
  const headingOffset = interpolateHeading(
    shot.headingOffsetFrom,
    shot.headingOffsetTo,
    eased,
  );

  return {
    chapter: shot.chapter,
    cut,
    elapsedSeconds: elapsed,
    durationSeconds,
    headingDeg: (routeHeading + headingOffset + 360) % 360,
    pitchDeg: interpolate(shot.fromPitchDeg, shot.toPitchDeg, eased),
    progress: elapsed / durationSeconds,
    rangeM: interpolate(shot.fromRangeM, shot.toRangeM, eased),
    routeProgressM: pose.progressM,
    showDecision: elapsed >= durationSeconds - 1.1,
    target: { lat: pose.lat, lng: pose.lng, elev: pose.elev },
    threadStartRatio: clamp(routeProgressRatio - shot.threadBehind),
    threadEndRatio: clamp(routeProgressRatio + shot.threadAhead),
    look: shot.look,
  };
}
