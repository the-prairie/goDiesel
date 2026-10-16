import { describe, expect, it } from "vitest";
import type { AdminWorkspace } from "@/data/admin-repository";
import { emptyCurationDraft, type AdminRouteRecord } from "./admin-curation";
import {
  initialAdminWorkspaceState,
  reduceAdminWorkspace,
  selectAdminWorkspace,
  type AdminWorkspaceEvent,
  type AdminWorkspaceState,
} from "./workspace-state";

const calgary: AdminRouteRecord = {
  activityId: "a", name: "Calgary River Path", region: "Calgary", date: "2025-11-24",
  type: "Run", distanceKm: 12, sourceStatus: "approved", curation: { ...emptyCurationDraft, vibe: "Original Calgary." },
  geometryStatus: "ready", replayEligible: true, generationStatus: "failed",
};
const kyoto = { ...calgary, activityId: "b", name: "Kyoto Temple Climb", region: "Kyoto" };
const workspace: AdminWorkspace = { mode: "editable", generationStatus: "failed", generatedAt: null, routes: [calgary, kyoto] };
const draftA = { ...calgary.curation, vibe: "Captured Calgary." };
const draftB = { ...kyoto.curation, vibe: "Captured Kyoto." };
const loaded = (data: AdminWorkspace = workspace) => reduceAdminWorkspace(initialAdminWorkspaceState(), { type: "workspaceLoaded", workspace: data });
const run = (state: AdminWorkspaceState, ...events: AdminWorkspaceEvent[]) => events.reduce(reduceAdminWorkspace, state);
const saveA: AdminWorkspaceEvent = { type: "saveStarted", routeId: "a", requestId: 1, draft: draftA };

function ready(state: AdminWorkspaceState) {
  if (state.status !== "ready") throw new Error("Expected loaded workspace");
  return state;
}

describe("Admin workspace transitions", () => {
  it("loads once and selects the first route without creating a dirty draft", () => {
    const loading = initialAdminWorkspaceState();
    expect(reduceAdminWorkspace(loading, { type: "queryEdited", query: "Kyoto" })).toBe(loading);
    const state = loaded();
    expect(selectAdminWorkspace(state)).toMatchObject({ effectiveSelectedId: "a", dirty: false, canSave: true });
    expect(reduceAdminWorkspace(state, { type: "workspaceLoaded", workspace: { ...workspace, routes: [] } })).toBe(state);
  });

  it("supports an empty workspace", () => {
    expect(selectAdminWorkspace(loaded({ ...workspace, routes: [] }))).toMatchObject({
      visibleRoutes: [], effectiveSelectedId: null, draft: null, dirty: false, canSave: false,
    });
  });

  it("filters all routes before applying the 200 row cap", () => {
    const state = loaded({ ...workspace, routes: Array.from({ length: 205 }, (_, i) => ({ ...calgary, activityId: `${i}`, name: `Route ${i}`, region: i === 204 ? "Hidden Valley" : "Calgary" })) });
    expect(selectAdminWorkspace(state).visibleRoutes).toHaveLength(200);
    expect(selectAdminWorkspace(run(state, { type: "queryEdited", query: "  hIdDeN VaLlEy  " }))).toMatchObject({ effectiveSelectedId: "204", matchingRoutes: [{ activityId: "204" }] });
  });

  it("retains the preferred route when search temporarily chooses another or no route", () => {
    const selected = run(loaded(), { type: "routeSelected", routeId: "b" });
    const filtered = run(selected, { type: "queryEdited", query: "Calgary" });
    expect(selectAdminWorkspace(filtered).effectiveSelectedId).toBe("a");
    const empty = run(filtered, { type: "queryEdited", query: "no match" });
    expect(selectAdminWorkspace(empty).effectiveSelectedId).toBeNull();
    expect(selectAdminWorkspace(run(empty, { type: "queryEdited", query: "" })).effectiveSelectedId).toBe("b");
  });

  it("retains independent drafts across search and selection", () => {
    const state = run(loaded(),
      { type: "draftEdited", routeId: "a", draft: draftA },
      { type: "queryEdited", query: "Kyoto" },
      { type: "draftEdited", routeId: "b", draft: draftB },
      { type: "queryEdited", query: "" });
    expect(selectAdminWorkspace(state)).toMatchObject({ draft: draftA, dirty: true });
    expect(selectAdminWorkspace(run(state, { type: "routeSelected", routeId: "b" }))).toMatchObject({ draft: draftB, dirty: true });
  });

  it("keeps incomplete reviewed drafts editable but prevents their save", () => {
    const draft = { ...draftA, reviewStatus: "reviewed" as const };
    const state = run(loaded(), { type: "draftEdited", routeId: "a", draft });
    expect(selectAdminWorkspace(state)).toMatchObject({ draft, canSave: false });
    expect(reduceAdminWorkspace(state, { ...saveA, draft })).toBe(state);
    expect(selectAdminWorkspace(run(state, { type: "draftEdited", routeId: "a", draft: draftA })).canSave).toBe(true);
  });

  it("saves a clean draft and only locks the initiating route", () => {
    const state = run(loaded(), { ...saveA, draft: calgary.curation });
    expect(selectAdminWorkspace(state)).toMatchObject({ saving: true, canSave: false, dirty: false });
    expect(reduceAdminWorkspace(state, { type: "draftEdited", routeId: "a", draft: draftA })).toBe(state);
    expect(reduceAdminWorkspace(state, { ...saveA, requestId: 2 })).toBe(state);
    expect(selectAdminWorkspace(run(state, { type: "routeSelected", routeId: "b" }))).toMatchObject({ saving: false, canSave: true });
  });

  it("settles concurrent saves on their initiating routes with captured drafts", () => {
    const pending = run(loaded(), { type: "draftEdited", routeId: "a", draft: draftA }, saveA,
      { type: "routeSelected", routeId: "b" }, { type: "draftEdited", routeId: "b", draft: draftB },
      { type: "saveStarted", routeId: "b", requestId: 2, draft: draftB });
    const before = structuredClone(pending);
    const settledA = run(pending, { type: "saveSucceeded", routeId: "a", requestId: 1 });
    expect(pending).toEqual(before);
    expect(ready(settledA).workspace.routes[0]).toMatchObject({ curation: draftA, generationStatus: "ready" });
    expect(selectAdminWorkspace(settledA)).toMatchObject({ draft: draftB, saving: true, dirty: true, saveMessage: null });
    const failedB = run(settledA, { type: "saveFailed", routeId: "b", requestId: 2, message: "Rebuild failed." });
    expect(selectAdminWorkspace(failedB)).toMatchObject({ draft: draftB, saving: false, dirty: true, saveMessage: "Rebuild failed." });
    expect(selectAdminWorkspace(run(failedB, { type: "routeSelected", routeId: "a" }))).toMatchObject({ dirty: false, saveMessage: "Saved. Manifest and route detail regenerated." });
  });

  it("clears a failure on editing and retrying captures the updated draft", () => {
    const failed = run(loaded(), saveA, { type: "saveFailed", routeId: "a", requestId: 1, message: "Failed." });
    const edited = run(failed, { type: "draftEdited", routeId: "a", draft: draftB });
    expect(selectAdminWorkspace(edited).saveMessage).toBeNull();
    const retried = run(edited, { type: "saveStarted", routeId: "a", requestId: 2, draft: draftB }, { type: "saveSucceeded", routeId: "a", requestId: 2 });
    expect(ready(retried).workspace.routes[0].curation).toEqual(draftB);
    expect(selectAdminWorkspace(retried).dirty).toBe(false);
  });

  for (const type of ["saveSucceeded", "saveFailed"] as const) {
    it(`rejects stale, unknown, and duplicate ${type}`, () => {
      const outcome = { type, routeId: "a", requestId: 0, message: "Old failure." };
      const pending = run(loaded(), saveA);
      expect(reduceAdminWorkspace(pending, outcome)).toBe(pending);
      expect(reduceAdminWorkspace(pending, { ...outcome, routeId: "unknown", requestId: 1 })).toBe(pending);
      const settled = run(pending, { ...outcome, requestId: 1 });
      expect(reduceAdminWorkspace(settled, { ...outcome, requestId: 1 })).toBe(settled);
      const retry = run(settled, { ...saveA, requestId: 2 });
      expect(reduceAdminWorkspace(retry, { ...outcome, requestId: 1 })).toBe(retry);
    });
  }

  it("read-only mode rejects edits and saves while accepting matching bundled detail", () => {
    const state = loaded({ mode: "read-only", generationStatus: "bundled", generatedAt: null, routes: [calgary, kyoto] });
    expect(reduceAdminWorkspace(state, saveA)).toBe(state);
    expect(reduceAdminWorkspace(state, { type: "draftEdited", routeId: "a", draft: draftA })).toBe(state);
    const pending = run(state, { type: "detailStarted", routeId: "a", requestId: 1 });
    expect(reduceAdminWorkspace(pending, { type: "detailReceived", routeId: "a", requestId: 0, draft: draftA })).toBe(pending);
    const hydrated = run(pending, { type: "detailReceived", routeId: "a", requestId: 1, draft: draftA });
    expect(selectAdminWorkspace(hydrated)).toMatchObject({ draft: draftA, canSave: false });
    expect(reduceAdminWorkspace(hydrated, { type: "detailReceived", routeId: "a", requestId: 1, draft: draftB })).toBe(hydrated);
  });

  it("ignores bundled detail for a previous selection and supports a summary fallback", () => {
    const state = loaded({ mode: "read-only", generationStatus: "bundled", generatedAt: null, routes: [calgary, kyoto] });
    const switched = run(state, { type: "detailStarted", routeId: "a", requestId: 1 }, { type: "queryEdited", query: "Kyoto" });
    expect(reduceAdminWorkspace(switched, { type: "detailReceived", routeId: "a", requestId: 1, draft: draftA })).toBe(switched);
    const settled = run(switched, { type: "detailStarted", routeId: "b", requestId: 2 }, { type: "detailReceived", routeId: "b", requestId: 2, draft: kyoto.curation });
    expect(selectAdminWorkspace(settled).draft).toEqual(kyoto.curation);
  });

  it("ignores unknown route actions and bundled outcomes in an editable workspace", () => {
    const state = loaded();
    for (const event of [
      { type: "routeSelected", routeId: "unknown" },
      { type: "draftEdited", routeId: "unknown", draft: draftA },
      { ...saveA, routeId: "unknown" },
      { type: "detailStarted", routeId: "a", requestId: 1 },
      { type: "detailReceived", routeId: "a", requestId: 1, draft: draftA },
    ] satisfies AdminWorkspaceEvent[]) expect(reduceAdminWorkspace(state, event)).toBe(state);
  });
});
