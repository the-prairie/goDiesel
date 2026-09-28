import { describe, expect, it } from "vitest";

import { replayReturnPath } from "@/app/route-paths";
import { adventureLegPath } from "@/surfaces/replay/adventure/adventure-paths";

function parse(path: string) {
  const [pathname, query = ""] = path.split("?");
  return { pathname, params: new URLSearchParams(query) };
}

describe("adventureLegPath", () => {
  it("keeps the presentation and moves the story return to the other recording", () => {
    const search = `?landscape=notebook&theme=journal&at=4200&from=${encodeURIComponent("/lab/design-seeds/d/story/222")}`;
    const { pathname, params } = parse(adventureLegPath(search, "222", "111"));
    expect(pathname).toBe("/replay/111");
    expect(params.get("landscape")).toBe("notebook");
    expect(params.get("theme")).toBe("journal");
    expect(params.has("at")).toBe(false);
    expect(replayReturnPath(params, "111")).toBe("/lab/design-seeds/d/story/111");
  });

  it("keeps an Atlas return unchanged", () => {
    const { params } = parse(adventureLegPath(`?from=${encodeURIComponent("/atlas?region=Crete")}`, "222", "111"));
    expect(params.get("from")).toBe("/atlas?region=Crete");
  });

  it("drops a return it cannot carry and enters at a held distance", () => {
    const { params } = parse(adventureLegPath(`?from=${encodeURIComponent("/finder")}`, "222", "111", 2900.4));
    expect(params.has("from")).toBe(false);
    expect(params.get("at")).toBe("2900");
  });
});
