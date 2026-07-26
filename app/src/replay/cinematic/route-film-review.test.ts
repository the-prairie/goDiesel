import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";

// @ts-expect-error The offline review tooling is intentionally a Node ESM module.
import * as routeFilmReview from "../../../scripts/route-film-review.mjs";

const {
  assertReviewPassed,
  createContactSheet,
  failedReviewEvidence,
  reviewFrameFailures,
  selectReviewFrames,
} = routeFilmReview;

const timeline = [
  { endSeconds: 6.4, kind: "establishing", startSeconds: 0 },
  { endSeconds: 12.6, kind: "reveal", startSeconds: 6.4 },
  { endSeconds: 19.8, kind: "tracking", startSeconds: 12.6 },
  { endSeconds: 25, kind: "tracking", startSeconds: 19.8 },
  { endSeconds: 32.6, kind: "summit", startSeconds: 25 },
  { endSeconds: 39.6, kind: "release", startSeconds: 32.6 },
];

function passingFrame(actIndex: number) {
  return {
    actIndex,
    qualityPassed: true,
    settled: true,
    stable: true,
  };
}

function png(red: number) {
  const image = new PNG({ height: 2, width: 3 });
  for (let index = 0; index < image.data.length; index += 4) {
    image.data[index] = red;
    image.data[index + 3] = 255;
  }
  return PNG.sync.write(image);
}

describe("route film review", () => {
  it.each([4, 5, 6, 7])(
    "selects six deterministic samples across a %s-shot timeline",
    (shotCount) => {
      const shotKinds = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf"];
      const shots = Array.from({ length: shotCount }, (_, index) => ({
        endSeconds: (index + 1) * 10,
        kind: shotKinds[index],
        metadata: { order: index + 1 },
        startSeconds: index * 10,
      }));
      const frames = selectReviewFrames(shots);

      expect(frames).toHaveLength(6);
      expect(frames.map((frame: { seconds: number }) => frame.seconds)).toEqual(
        [
          shotCount * 10 / 12,
          shotCount * 10 / 4,
          shotCount * 10 * 5 / 12,
          shotCount * 10 * 7 / 12,
          shotCount * 10 * 3 / 4,
          shotCount * 10 * 11 / 12,
        ].map((seconds) => Number(seconds.toFixed(6))),
      );
      expect(frames.map((frame: { filename: string }) => frame.filename)).toEqual(
        Array.from(
          { length: 6 },
          (_, index) => `review-sample-${String(index + 1).padStart(2, "0")}-${shotKinds[Math.floor((index + 0.5) * shotCount / 6)]}.png`,
        ),
      );
      expect(frames.every((frame: { metadata: { order: number } }) => frame.metadata.order > 0)).toBe(true);
    },
  );

  it("preserves the resolved shot metadata for each selected sample", () => {
    const frames = selectReviewFrames(timeline);
    expect(frames[0]).toMatchObject({
      actIndex: 0,
      kind: "establishing",
      shotIndex: 0,
      startSeconds: 0,
    });
    expect(frames[5]).toMatchObject({
      actIndex: 5,
      endSeconds: 39.6,
      kind: "release",
      shotIndex: 5,
    });
  });

  it("fails closed on incomplete, unstable, or low-quality evidence", () => {
    expect(() => selectReviewFrames([])).toThrow(
      "cinematic shot timeline",
    );

    const frames = Array.from({ length: 6 }, (_, index) =>
      passingFrame(index),
    );
    frames[2].qualityPassed = false;
    frames[4].settled = false;

    expect(reviewFrameFailures(frames)).toEqual([
      "sample 3 failed visual quality",
      "sample 5 did not stabilize",
    ]);
    expect(() => assertReviewPassed(frames)).toThrow(
      "sample 3 failed visual quality; sample 5 did not stabilize",
    );
  });

  it("rejects gapped act timing instead of reviewing ambiguous frames", () => {
    const gapped = timeline.map((shot) => ({ ...shot }));
    gapped[3].startSeconds += 0.1;
    expect(() => selectReviewFrames(gapped)).toThrow(
      "Cinematic act 4 has invalid timing",
    );
  });

  it("writes six equal frames into a deterministic three-by-two sheet", () => {
    const sheet = PNG.sync.read(
      createContactSheet([png(10), png(20), png(30), png(40), png(50), png(60)]),
    );
    expect({ height: sheet.height, width: sheet.width }).toEqual({
      height: 4,
      width: 9,
    });

    const redAt = (x: number, y: number) =>
      sheet.data[(y * sheet.width + x) * 4];
    expect([redAt(0, 0), redAt(3, 0), redAt(6, 0)]).toEqual([10, 20, 30]);
    expect([redAt(0, 2), redAt(3, 2), redAt(6, 2)]).toEqual([40, 50, 60]);
  });

  it("omits stale contact-sheet output from failed evidence", () => {
    const failed = failedReviewEvidence(
      { contactSheet: "/tmp/contact-sheet.png", frames: [], status: "capturing" },
      ["capture failed", "capture failed"],
    );

    expect(failed).toEqual({
      failures: ["capture failed"],
      frames: [],
      status: "failed",
    });
  });
});
