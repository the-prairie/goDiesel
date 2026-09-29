import { describe, expect, it } from "vitest";

import { replayReturnPath } from "@/app/route-paths";
import { chapterReplayHref } from "@/surfaces/routes/route-adventure";

const parse = (href: string) => {
  const [pathname, query = ""] = href.split("?");
  return { pathname, params: new URLSearchParams(query) };
};

describe("chapterReplayHref", () => {
  it("enters Replay on the chapter's own recording at its own distance", () => {
    const { pathname, params } = parse(chapterReplayHref("14130782031", 2909.4));
    expect(pathname).toBe("/replay/14130782031");
    expect(params.get("at")).toBe("2909");
  });

  it("returns to that recording's story, which Replay accepts as its way back", () => {
    const { params } = parse(chapterReplayHref("14130772463", 0));
    expect(params.get("from")).toBe("/routes/14130772463");
    expect(replayReturnPath(params, "14130772463")).toBe("/routes/14130772463");
  });

  it("opens at the start for a chapter at 0 m", () => {
    expect(parse(chapterReplayHref("14130772463", 0)).params.has("at")).toBe(false);
  });
});
