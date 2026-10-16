import { describe, expect, it } from "vitest";
import type { SearchDocument } from "@/domain/search/ranking";
import { initialCollectionSearchState, reduceCollectionSearch, selectCollectionSearch } from "./collection-search-state";

const docs: SearchDocument[] = [{ slug: "kyoto", text: "Kyoto", terrain: [], highlights: [], vector: [1] }];
const loading = reduceCollectionSearch(initialCollectionSearchState(), { type: "searchStarted", key: "kyoto", requestId: 1 });
const embedding = reduceCollectionSearch(loading, { type: "indexReceived", requestId: 1, docs, refine: true });

describe("collection search lifecycle", () => {
  it("keeps basic results available before index load and for unmatched keys", () => {
    expect(selectCollectionSearch(loading, "kyoto")).toMatchObject({ docs: [], limited: false });
    expect(selectCollectionSearch(embedding, "london")).toMatchObject({ docs: [], vector: undefined, limited: false });
  });
  it("retains indexed keyword results during refinement", () => {
    expect(selectCollectionSearch(embedding, "kyoto")).toMatchObject({ docs, mode: "Finding related guide themes…" });
  });
  it("skips embeddings for empty themes and similarity requests", () => {
    const state = reduceCollectionSearch(loading, { type: "indexReceived", requestId: 1, docs, refine: false });
    expect(state.phase).toBe("keywordReady");
    expect(selectCollectionSearch(state, "kyoto").docs).toBe(docs);
  });
  it("publishes semantic vectors with the owning index", () => {
    const state = reduceCollectionSearch(embedding, { type: "embeddingReceived", requestId: 1, vector: [0.5], failed: false });
    expect(selectCollectionSearch(state, "kyoto")).toMatchObject({ docs, vector: [0.5], limited: false });
  });
  it.each(["index", "construction"])("discards documents on %s failure", failure => {
    const state = reduceCollectionSearch(failure === "index" ? loading : embedding, { type: "indexFailed", requestId: 1 });
    expect(selectCollectionSearch(state, "kyoto")).toMatchObject({ docs: [], vector: undefined, limited: true });
  });
  it.each(["error", "deadline"])("retains documents on worker %s", () => {
    const state = reduceCollectionSearch(embedding, { type: "embeddingFailed", requestId: 1 });
    expect(selectCollectionSearch(state, "kyoto")).toMatchObject({ docs, vector: undefined, limited: true });
  });
  it("handles a worker's error response as keyword fallback", () => {
    expect(reduceCollectionSearch(embedding, { type: "embeddingReceived", requestId: 1, failed: true }).phase).toBe("keywordFallback");
  });
  it("rejects replaced operations even when their serialized input matches", () => {
    const next = reduceCollectionSearch(embedding, { type: "searchStarted", key: "kyoto", requestId: 2 });
    expect(reduceCollectionSearch(next, { type: "embeddingReceived", requestId: 1, vector: [1], failed: false })).toBe(next);
    expect(reduceCollectionSearch(next, { type: "indexReceived", requestId: 1, docs, refine: true })).toBe(next);
  });
  it("ignores completion in the wrong stage and after settlement", () => {
    expect(reduceCollectionSearch(loading, { type: "embeddingFailed", requestId: 1 })).toBe(loading);
    const state = reduceCollectionSearch(embedding, { type: "embeddingFailed", requestId: 1 });
    expect(reduceCollectionSearch(state, { type: "embeddingReceived", requestId: 1, failed: false })).toBe(state);
  });
});
