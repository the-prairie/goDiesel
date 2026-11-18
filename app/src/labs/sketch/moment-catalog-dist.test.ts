import { describe, expect, it } from "vitest";

// The build's rule for her moments (make-dist.sh runs it on dist/).
import { publicMoments } from "../../../scripts/moments-dist.mjs";

const data = {
  catalog: [
    { id: "cleared", kind: "tv-wall", title: "Cleared", clip: "/moments/cleared.mp4", caption: "a line", public: true },
    { id: "private", kind: "tv-wall", title: "Private joke", clip: "/moments/private.mp4" },
    { id: "unflagged", kind: "tv-wall", title: "Not said", clip: "/moments/unflagged.mp4", public: false },
  ],
  placements: [
    { id: "p1", entryId: "cleared", at: { lng: 1, lat: 1 }, facingDeg: 0 },
    { id: "p2", entryId: "private", at: { lng: 2, lat: 2 }, facingDeg: 0 },
    { id: "p3", entryId: null, at: { lng: 3, lat: 3 }, facingDeg: 0 },
  ],
};

describe("what a build ships of her moments", () => {
  it("ships only entries she flagged public, their places and their clips", () => {
    const { moments, clips } = publicMoments(data, () => true);
    expect(moments!.catalog.map((e: { id: string }) => e.id)).toEqual(["cleared"]);
    expect(moments!.placements.map((p: { id: string }) => p.id)).toEqual(["p1"]);
    expect(clips).toEqual(["cleared.mp4"]);
  });

  it("falls back to no signal when a public entry's clip is not on this machine", () => {
    const { moments, clips } = publicMoments(data, () => false);
    expect(moments!.catalog[0]).toMatchObject({ id: "cleared", clip: null });
    expect(clips).toEqual([]);
  });

  it("never ships a clip from outside the moments folder", () => {
    const sneaky = { ...data, catalog: [{ ...data.catalog[0], clip: "/moments/../secret.mp4" }] };
    expect(publicMoments(sneaky, () => true).clips).toEqual([]);
  });

  it("ships nothing when there is no private catalog", () => {
    expect(publicMoments(null, () => true)).toEqual({ moments: null, clips: [] });
  });
});
