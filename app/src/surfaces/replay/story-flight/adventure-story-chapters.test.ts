import { describe, expect, it } from "vitest";

import { syntheticAdventureJson, syntheticRoute } from "@/domain/adventure/adventure-fixtures";
import { parseAdventure } from "@/domain/adventure/parse";
import { placeAdventureOnRoute } from "@/domain/adventure/placement";
import { activeReplayStoryChapter, adventureStoryChapters } from "@/surfaces/replay/story-flight/story-flight-chapters";

const adventure = parseAdventure(syntheticAdventureJson());

describe("adventureStoryChapters", () => {
  it("uses the owner's chapters, numbered across the whole adventure", () => {
    const chapters = adventureStoryChapters(placeAdventureOnRoute(adventure, syntheticRoute("leg-two", 4_000))!, 4_000);
    expect(chapters.map((chapter) => [chapter.label, chapter.ordinal])).toEqual([
      ["Start", undefined],
      ["The saddle", 2],
      ["The top", 3],
    ]);
  });

  it("does not claim a chapter before the reader reaches it", () => {
    const chapters = adventureStoryChapters(placeAdventureOnRoute(adventure, syntheticRoute("leg-two", 4_000))!, 4_000);
    expect(chapters[activeReplayStoryChapter(chapters, 500)].label).toBe("Start");
  });

  it("needs no start entry when a chapter opens the recording", () => {
    const chapters = adventureStoryChapters(placeAdventureOnRoute(adventure, syntheticRoute("leg-one", 4_000))!, 4_000);
    expect(chapters[0]).toMatchObject({ label: "Start", ordinal: 1 });
  });
});
