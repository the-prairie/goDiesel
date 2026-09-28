import { describe, expect, it } from "vitest";

import { syntheticAdventureJson } from "@/domain/adventure/adventure-fixtures";
import { parseAdventure } from "@/domain/adventure/parse";
import {
  beatDuration,
  filmDuration,
  filmPosition,
  shotAt,
  tourDuration,
  tourPose,
} from "@/domain/adventure/timeline";

const adventure = parseAdventure(syntheticAdventureJson());
const film = adventure.film!;
const shots = [
  { atS: 0, title: "A", position: [0, 0, 0] as [number, number, number], target: [0, 0, 0] as [number, number, number] },
  { atS: 4, title: "B", position: [10, 0, 0] as [number, number, number], target: [0, 10, 0] as [number, number, number] },
  { atS: 10, title: "C", position: [10, 10, 0] as [number, number, number], target: [0, 10, 10] as [number, number, number] },
];

describe("film timeline", () => {
  it("measures each beat by its own trim or duration", () => {
    expect(film.beats.map(beatDuration)).toEqual([4, 3, 5]);
    expect(filmDuration(film)).toBe(12);
  });

  it("gives an exact boundary to the next beat", () => {
    expect(filmPosition(film, 3.99).index).toBe(0);
    expect(filmPosition(film, 4).index).toBe(1);
    expect(filmPosition(film, 4).elapsed).toBe(0);
  });

  it("holds the final frame at and beyond the end", () => {
    const end = filmPosition(film, 99);
    expect(end.index).toBe(2);
    expect(end.elapsed).toBe(5);
  });
});

describe("scene tour", () => {
  it("lasts until its last authored viewpoint", () => {
    expect(tourDuration(shots)).toBe(10);
  });

  it("passes exactly through each authored viewpoint", () => {
    expect(tourPose(shots, 4).position).toEqual([10, 0, 0]);
    expect(tourPose(shots, 10).target).toEqual([0, 10, 10]);
  });

  it("never overshoots an axis between viewpoints", () => {
    for (let t = 0; t <= 10; t += 0.25) {
      const { position } = tourPose(shots, t);
      expect(position[0]).toBeGreaterThanOrEqual(-1e-9);
      expect(position[0]).toBeLessThanOrEqual(10 + 1e-9);
    }
  });

  it("names the viewpoint the tour is showing", () => {
    expect(shotAt(shots, 3.9)).toBe(0);
    expect(shotAt(shots, 4)).toBe(1);
    expect(shotAt(shots, 50)).toBe(2);
  });
});
