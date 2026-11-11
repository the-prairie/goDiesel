import { describe, expect, it } from "vitest";
import { initialExternalRankingState, reduceExternalRanking, selectExternalRanking } from "./external-ranking-state";

const pending = reduceExternalRanking(initialExternalRankingState(), { type: "rankingStarted", key: "coast", requestId: 1 });
const vectors = [[1], [0], [1]];

describe("external ranking lifecycle", () => {
  it("keeps keyword ranking available while embeddings are pending", () => {
    expect(selectExternalRanking(pending, "coast", true)).toEqual({ vectors: undefined, mode: "Refining matches…", limited: false });
  });
  it("publishes vectors only for their input key", () => {
    const ready = reduceExternalRanking(pending, { type: "embeddingReceived", requestId: 1, vectors, failed: false });
    expect(selectExternalRanking(ready, "coast", true)).toEqual({ vectors, mode: "Keyword + related-theme ranking", limited: false });
    expect(selectExternalRanking(ready, "forest", true)).toEqual({ vectors: undefined, mode: "Ranking matches…", limited: false });
  });
  it("preserves error response payloads while reporting limited ranking", () => {
    const ready = reduceExternalRanking(pending, { type: "embeddingReceived", requestId: 1, vectors, failed: true });
    expect(selectExternalRanking(ready, "coast", true)).toMatchObject({ vectors, limited: true });
  });
  it("falls back after worker failure or deadline without vectors", () => {
    const failed = reduceExternalRanking(pending, { type: "embeddingFailed", requestId: 1 });
    expect(selectExternalRanking(failed, "coast", true)).toEqual({ vectors: undefined, mode: "Keyword ranking · related-theme search unavailable", limited: true });
  });
  it("accepts an empty success payload without inventing an error", () => {
    const ready = reduceExternalRanking(pending, { type: "embeddingReceived", requestId: 1, failed: false });
    expect(selectExternalRanking(ready, "coast", true)).toMatchObject({ vectors: undefined, limited: false });
  });
  it("does not show previous state for disabled ranking", () => {
    const failed = reduceExternalRanking(pending, { type: "embeddingFailed", requestId: 1 });
    expect(selectExternalRanking(failed, "coast", false)).toEqual({ vectors: undefined, mode: "", limited: false });
  });
  it("restarts the same input without retaining previous vectors", () => {
    const ready = reduceExternalRanking(pending, { type: "embeddingReceived", requestId: 1, vectors, failed: false });
    const restarted = reduceExternalRanking(ready, { type: "rankingStarted", key: "coast", requestId: 2 });
    expect(selectExternalRanking(restarted, "coast", true).vectors).toBeUndefined();
    expect(reduceExternalRanking(restarted, { type: "embeddingReceived", requestId: 1, vectors, failed: false })).toBe(restarted);
    expect(reduceExternalRanking(restarted, { type: "embeddingFailed", requestId: 1 })).toBe(restarted);
  });
  it("ignores outcomes before a request and after settlement", () => {
    const idle = initialExternalRankingState();
    const failed = reduceExternalRanking(pending, { type: "embeddingFailed", requestId: 1 });
    expect(reduceExternalRanking(idle, { type: "embeddingFailed", requestId: 1 })).toBe(idle);
    expect(reduceExternalRanking(failed, { type: "embeddingReceived", requestId: 1, vectors, failed: false })).toBe(failed);
  });
});
