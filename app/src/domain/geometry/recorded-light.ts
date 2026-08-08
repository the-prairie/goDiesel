import type { RoutePoint, RouteTemporalProvenance } from "@/domain/route";

export type RecordedLightPhase = "neutral" | "dawn" | "midday" | "dusk" | "night";

export type RecordedLight =
  | { status: "neutral"; phase: "neutral" }
  | {
      status: "recorded";
      phase: Exclude<RecordedLightPhase, "neutral">;
      localTimeLabel: string;
    };

export function recordedLightAt(
  route: RoutePoint[],
  temporal: RouteTemporalProvenance,
  progressM: number,
): RecordedLight {
  if (
    temporal.status !== "recorded" ||
    !temporal.startTimeUtc ||
    !temporal.timeZone
  ) {
    return { status: "neutral", phase: "neutral" };
  }

  const startMs = Date.parse(temporal.startTimeUtc);
  if (!Number.isFinite(startMs)) return { status: "neutral", phase: "neutral" };
  const elapsedS = elapsedAtDistance(route, progressM, temporal.elapsedTimeS ?? 0);
  const timestamp = new Date(startMs + elapsedS * 1_000);

  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: temporal.timeZone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(timestamp);
    const hour = Number(parts.find(({ type }) => type === "hour")?.value);
    const minute = Number(parts.find(({ type }) => type === "minute")?.value);
    const second = Number(parts.find(({ type }) => type === "second")?.value);
    const localHour = hour + minute / 60 + second / 3_600;
    const phase = phaseAtHour(localHour);
    const localTimeLabel = new Intl.DateTimeFormat("en-US", {
      timeZone: temporal.timeZone,
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(timestamp);
    return { status: "recorded", phase, localTimeLabel };
  } catch {
    return { status: "neutral", phase: "neutral" };
  }
}

function phaseAtHour(hour: number): Exclude<RecordedLightPhase, "neutral"> {
  if (hour >= 5 && hour < 8) return "dawn";
  if (hour >= 8 && hour < 17) return "midday";
  if (hour >= 17 && hour < 21) return "dusk";
  return "night";
}

function elapsedAtDistance(
  route: RoutePoint[],
  progressM: number,
  fallbackElapsedS: number,
) {
  const timed = route.filter(
    (point): point is RoutePoint & { elapsedS: number } =>
      point.elapsedS !== undefined && Number.isFinite(point.elapsedS),
  );
  if (timed.length > 0) {
    if (progressM <= timed[0].d) return timed[0].elapsedS;
    for (let index = 1; index < timed.length; index += 1) {
      const current = timed[index];
      if (current.d < progressM) continue;
      const previous = timed[index - 1];
      const spanM = current.d - previous.d;
      const ratio = spanM > 0 ? (progressM - previous.d) / spanM : 0;
      return previous.elapsedS + (current.elapsedS - previous.elapsedS) * ratio;
    }
    return timed.at(-1)!.elapsedS;
  }

  const totalDistanceM = route.at(-1)?.d ?? 0;
  const ratio = totalDistanceM > 0 ? Math.min(1, Math.max(0, progressM / totalDistanceM)) : 0;
  return fallbackElapsedS * ratio;
}
