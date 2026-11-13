// The light a town shows for one of her runs: the time of day the run
// started where it was run. The start is read in the route's own time
// zone, or, without one, as solar time from the longitude; never by the
// viewer's clock. A run with no recorded start shows the place's default.

export type TownLight = "dawn" | "morning" | "midday" | "golden" | "dusk" | "night";

export const TOWN_LIGHTS: readonly TownLight[] = ["dawn", "morning", "midday", "golden", "dusk", "night"];

/** The light a town shows when no signpost is chosen: the approved golden hour. */
export const PLACE_DEFAULT_LIGHT: TownLight = "golden";

export interface RunStart {
  startTimeUtc?: string;
  timeZone?: string;
  lng: number;
}

function zoneHour(timestamp: Date, timeZone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(timestamp);
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    const minute = Number(parts.find((part) => part.type === "minute")?.value);
    return Number.isFinite(hour) && Number.isFinite(minute) ? hour + minute / 60 : null;
  } catch {
    return null;
  }
}

/** The local hour the run started, from 0 to 24, or null without a valid start. */
export function localStartHour({ startTimeUtc, timeZone, lng }: RunStart): number | null {
  if (!startTimeUtc) return null;
  const ms = Date.parse(startTimeUtc);
  if (!Number.isFinite(ms)) return null;
  const timestamp = new Date(ms);
  const zoned = timeZone ? zoneHour(timestamp, timeZone) : null;
  if (zoned !== null) return zoned;
  const utcHour = timestamp.getUTCHours() + timestamp.getUTCMinutes() / 60;
  return (((utcHour + lng / 15) % 24) + 24) % 24;
}

export function lightAtHour(hour: number): TownLight {
  if (hour < 5 || hour >= 21) return "night";
  if (hour < 7) return "dawn";
  if (hour < 10.5) return "morning";
  if (hour < 15) return "midday";
  if (hour < 18) return "golden";
  return "dusk";
}

export function runLight(start: RunStart): TownLight {
  const hour = localStartHour(start);
  return hour === null ? PLACE_DEFAULT_LIGHT : lightAtHour(hour);
}
