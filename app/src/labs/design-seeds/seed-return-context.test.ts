import { beforeEach, describe, expect, it } from "vitest";

import {
  clearJournalPositions,
  journalReturnKey,
  readJournalPosition,
  writeJournalPosition,
} from "@/labs/design-seeds/seed-return-context";

describe("journalReturnKey", () => {
  it("identifies a journey by concept, region and presentation", () => {
    expect(
      journalReturnKey({ concept: "b", region: "Crete, Greece", theme: "journal", typeface: "role" }),
    ).toBe("b|Crete%2C%20Greece|journal|role");
  });

  it("ignores the selected day, so choosing another day keeps the position", () => {
    const a = journalReturnKey({ concept: "b", region: "Crete, Greece" });
    const b = journalReturnKey({ concept: "b", region: "Crete, Greece" });
    expect(a).toBe(b);
  });

  it("separates regions, so one journey cannot restore into another", () => {
    expect(journalReturnKey({ concept: "b", region: "Crete, Greece" })).not.toBe(
      journalReturnKey({ concept: "b", region: "Banff/Kananaskis" }),
    );
  });

  it("separates presentations, because a different cast reflows the list", () => {
    const base = { concept: "b", region: "Crete, Greece" };
    expect(journalReturnKey({ ...base, typeface: "cormorant" })).not.toBe(
      journalReturnKey({ ...base, typeface: "source-serif" }),
    );
    expect(journalReturnKey({ ...base, theme: "journal" })).not.toBe(
      journalReturnKey({ ...base, theme: "expedition" }),
    );
  });

  it("cannot be confused by a region that contains the separator", () => {
    expect(journalReturnKey({ concept: "b", region: "a|b" })).not.toBe(
      journalReturnKey({ concept: "b", region: "a", theme: "b" }),
    );
  });
});

describe("journal position store", () => {
  beforeEach(() => {
    clearJournalPositions();
  });

  it("returns nothing for a journey that has not been read", () => {
    expect(readJournalPosition(journalReturnKey({ concept: "b", region: "Rome, Italy" }))).toBeUndefined();
  });

  it("round-trips a position for its own journey only", () => {
    const crete = journalReturnKey({ concept: "b", region: "Crete, Greece" });
    const banff = journalReturnKey({ concept: "b", region: "Banff/Kananaskis" });
    writeJournalPosition(crete, 134);
    expect(readJournalPosition(crete)).toBe(134);
    expect(readJournalPosition(banff)).toBeUndefined();
  });

  it("rounds and floors, so a fractional or negative offset cannot be stored", () => {
    const key = journalReturnKey({ concept: "b", region: "Crete, Greece" });
    writeJournalPosition(key, 134.6);
    expect(readJournalPosition(key)).toBe(135);
    writeJournalPosition(key, -20);
    expect(readJournalPosition(key)).toBe(0);
  });

  it("ignores an empty key rather than storing an unscoped position", () => {
    writeJournalPosition("", 200);
    expect(readJournalPosition("")).toBeUndefined();
  });

  it("keeps the most recently read journeys and evicts the oldest", () => {
    for (let i = 0; i < 14; i += 1) {
      writeJournalPosition(journalReturnKey({ concept: "b", region: `Region ${i}` }), i * 10);
    }
    expect(readJournalPosition(journalReturnKey({ concept: "b", region: "Region 0" }))).toBeUndefined();
    expect(readJournalPosition(journalReturnKey({ concept: "b", region: "Region 13" }))).toBe(130);
  });

  it("refreshes a re-read journey so it is not evicted as stale", () => {
    const first = journalReturnKey({ concept: "b", region: "Region 0" });
    writeJournalPosition(first, 5);
    for (let i = 1; i < 12; i += 1) {
      writeJournalPosition(journalReturnKey({ concept: "b", region: `Region ${i}` }), i);
    }
    writeJournalPosition(first, 42);
    writeJournalPosition(journalReturnKey({ concept: "b", region: "Region 99" }), 1);
    expect(readJournalPosition(first)).toBe(42);
  });
});
