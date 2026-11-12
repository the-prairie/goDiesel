import { describe, expect, it } from "vitest";

import { diveStart } from "@/labs/overland/model/dive";

const MINI = { left: 120, top: 200, width: 168, height: 144 };

describe("diveStart", () => {
  for (const [width, height] of [[390, 844], [1440, 900]]) {
    it(`puts the visible part of the full-screen cover exactly over the entry's little map (${width}×${height})`, () => {
      const { scale, translateX, translateY, clip } = diveStart(MINI, { width, height });
      const left = translateX + scale * clip.left;
      const top = translateY + scale * clip.top;
      const right = translateX + scale * (width - clip.right);
      const bottom = translateY + scale * (height - clip.bottom);
      expect(left).toBeCloseTo(MINI.left);
      expect(top).toBeCloseTo(MINI.top);
      expect(right).toBeCloseTo(MINI.left + MINI.width);
      expect(bottom).toBeCloseTo(MINI.top + MINI.height);
    });

    it(`scales evenly and shows the middle of the cover (${width}×${height})`, () => {
      const { clip } = diveStart(MINI, { width, height });
      expect(clip.left).toBeCloseTo(clip.right);
      expect(clip.top).toBeCloseTo(clip.bottom);
      expect(Math.min(clip.left, clip.top)).toBeCloseTo(0);
    });
  }
});
