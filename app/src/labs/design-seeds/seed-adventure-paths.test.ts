import { describe, expect, it } from "vitest";

import { adventureStoryPath } from "@/labs/design-seeds/seed-adventure-paths";

const parse = (path: string) => {
  const [pathname, query = ""] = path.split("?");
  return { pathname, params: new URLSearchParams(query) };
};

describe("adventureStoryPath", () => {
  const from = "/lab/design-seeds/d/atlas?region=Crete%2C+Greece&route=14130782031";
  const search = `?from=${encodeURIComponent(from)}&at=6762`;

  it("targets each chapter's own distance, not the one held here", () => {
    for (const atM of [0, 2909.4, 11030.5]) {
      const { pathname, params } = parse(adventureStoryPath("/lab/design-seeds/d/story/14130782031", search, "14130772463", atM));
      expect(pathname).toBe("/lab/design-seeds/d/story/14130772463");
      expect(params.get("at")).toBe(String(Math.round(atM)));
    }
  });

  it("keeps the parent return separately", () => {
    const { params } = parse(adventureStoryPath("/lab/design-seeds/d/story/14130782031", search, "14130772463", 0));
    expect(params.get("from")).toBe(from);
  });
});
