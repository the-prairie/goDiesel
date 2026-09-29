// Film and scene-tour clocks. Pure and runtime-import free.

import type { AdventureFilm, AdventureFilmBeat, AdventureSceneShot } from "@/domain/adventure/contract";

export function beatDuration(beat: AdventureFilmBeat) {
  return beat.kind === "footage" ? beat.outS - beat.inS : beat.durationS;
}

export function filmDuration(film: AdventureFilm) {
  return film.beats.reduce((sum, beat) => sum + beatDuration(beat), 0);
}

/** Exact boundaries belong to the next beat; the end holds the last frame. */
export function filmPosition(film: AdventureFilm, seconds: number) {
  const time = Math.max(0, Math.min(filmDuration(film), Number.isFinite(seconds) ? seconds : 0));
  let start = 0;
  for (let index = 0; index < film.beats.length; index += 1) {
    const beat = film.beats[index];
    const duration = beatDuration(beat);
    if (time < start + duration || index === film.beats.length - 1) {
      return { beat, index, start, elapsed: Math.min(duration, time - start), duration };
    }
    start += duration;
  }
  throw new Error("adventure film has no beats");
}

/** Where along the recording the film's route beat is at this time, 0..1. */
export function routeBeatFraction(film: AdventureFilm, seconds: number) {
  const position = filmPosition(film, seconds);
  if (position.beat.kind !== "route" || seconds >= position.start + position.duration) return undefined;
  return Math.min(1, Math.max(0, position.elapsed / position.duration));
}

type Vec3 = [number, number, number];

export function tourDuration(shots: AdventureSceneShot[]) {
  return shots.at(-1)?.atS ?? 0;
}

export function clampTourTime(seconds: number, shots: AdventureSceneShot[]) {
  return Math.max(0, Math.min(Number.isFinite(seconds) ? seconds : 0, tourDuration(shots)));
}

/**
 * The camera between authored viewpoints: shape-preserving Hermite
 * interpolation, so motion carries through each viewpoint without any axis
 * leaving its authored bounds. Ported from the adventure player.
 */
export function tourPose(shots: AdventureSceneShot[], seconds: number): { position: Vec3; target: Vec3 } {
  if (shots.length === 1) return { position: shots[0].position, target: shots[0].target };
  const time = clampTourTime(seconds, shots);
  let i = 0;
  while (i < shots.length - 2 && shots[i + 1].atS < time) i += 1;
  const a = shots[i];
  const b = shots[i + 1];
  const duration = b.atS - a.atS;
  const t = Math.max(0, Math.min(1, (time - a.atS) / duration));
  if (t === 0) return { position: a.position, target: a.target };
  if (t === 1) return { position: b.position, target: b.target };
  const mix = (field: "position" | "target") =>
    a[field].map((value, axis) => {
      const slope = (k: number) => (shots[k + 1][field][axis] - shots[k][field][axis]) / (shots[k + 1].atS - shots[k].atS);
      const tangent = (k: number) => {
        if (k === 0) return slope(0);
        if (k === shots.length - 1) return 0;
        const before = slope(k - 1);
        const after = slope(k);
        if (before * after <= 0) return 0;
        const previousDuration = shots[k].atS - shots[k - 1].atS;
        const nextDuration = shots[k + 1].atS - shots[k].atS;
        const w1 = 2 * nextDuration + previousDuration;
        const w2 = nextDuration + 2 * previousDuration;
        return (w1 + w2) / (w1 / before + w2 / after);
      };
      return (
        (2 * t ** 3 - 3 * t ** 2 + 1) * value +
        (t ** 3 - 2 * t ** 2 + t) * duration * tangent(i) +
        (-2 * t ** 3 + 3 * t ** 2) * b[field][axis] +
        (t ** 3 - t ** 2) * duration * tangent(i + 1)
      );
    }) as Vec3;
  return { position: mix("position"), target: mix("target") };
}

export function shotAt(shots: AdventureSceneShot[], seconds: number) {
  let i = 0;
  while (i < shots.length - 1 && shots[i + 1].atS <= seconds) i += 1;
  return i;
}

export function formatClock(seconds: number) {
  const whole = Math.floor(Math.max(0, seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
