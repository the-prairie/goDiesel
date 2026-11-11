import type { AdminWorkspace } from "@/data/admin-repository";
import { validateCuration, type CurationDraft } from "./admin-curation";

type RouteSaveState =
  | { status: "idle" }
  | { status: "saving"; requestId: number; draft: CurationDraft }
  | { status: "saved" }
  | { status: "failed"; message: string };

export type AdminWorkspaceState =
  | { status: "loading" }
  | {
      status: "ready";
      workspace: AdminWorkspace;
      selectedId: string | null;
      query: string;
      drafts: Record<string, CurationDraft>;
      saves: Record<string, RouteSaveState>;
      detail: { routeId: string; requestId: number } | null;
    };

export type AdminWorkspaceEvent =
  | { type: "workspaceLoaded"; workspace: AdminWorkspace }
  | { type: "queryEdited"; query: string }
  | { type: "routeSelected"; routeId: string }
  | { type: "draftEdited"; routeId: string; draft: CurationDraft }
  | { type: "detailStarted"; routeId: string; requestId: number }
  | { type: "detailReceived"; routeId: string; requestId: number; draft: CurationDraft }
  | { type: "saveStarted"; routeId: string; requestId: number; draft: CurationDraft }
  | { type: "saveSucceeded"; routeId: string; requestId: number }
  | { type: "saveFailed"; routeId: string; requestId: number; message: string };

export function initialAdminWorkspaceState(): AdminWorkspaceState {
  return { status: "loading" };
}

export function reduceAdminWorkspace(
  state: AdminWorkspaceState,
  event: AdminWorkspaceEvent,
): AdminWorkspaceState {
  if (event.type === "workspaceLoaded") {
    return state.status === "loading"
      ? {
          status: "ready",
          workspace: event.workspace,
          selectedId: event.workspace.routes[0]?.activityId ?? null,
          query: "", drafts: {}, saves: {}, detail: null,
        }
      : state;
  }
  if (state.status === "loading") return state;

  switch (event.type) {
    case "queryEdited":
      return { ...state, query: event.query };
    case "routeSelected":
      return state.workspace.routes.some((route) => route.activityId === event.routeId)
        ? { ...state, selectedId: event.routeId }
        : state;
    case "draftEdited":
      if (
        state.workspace.mode !== "editable" || state.saves[event.routeId]?.status === "saving" ||
        !state.workspace.routes.some((route) => route.activityId === event.routeId)
      ) return state;
      return {
        ...state,
        drafts: { ...state.drafts, [event.routeId]: event.draft },
        saves: { ...state.saves, [event.routeId]: { status: "idle" } },
      };
    case "detailStarted":
      if (state.workspace.mode !== "read-only" || selectAdminWorkspace(state).effectiveSelectedId !== event.routeId) return state;
      return { ...state, detail: { routeId: event.routeId, requestId: event.requestId } };
    case "detailReceived":
      if (
        state.workspace.mode !== "read-only" || state.detail?.routeId !== event.routeId ||
        state.detail.requestId !== event.requestId || selectAdminWorkspace(state).effectiveSelectedId !== event.routeId
      ) return state;
      return { ...state, detail: null, drafts: { ...state.drafts, [event.routeId]: event.draft } };
    case "saveStarted":
      if (
        state.workspace.mode !== "editable" || state.saves[event.routeId]?.status === "saving" ||
        !state.workspace.routes.some((route) => route.activityId === event.routeId) || !validateCuration(event.draft).canSave
      ) return state;
      return {
        ...state,
        saves: { ...state.saves, [event.routeId]: { status: "saving", requestId: event.requestId, draft: event.draft } },
      };
    case "saveSucceeded": {
      const pending = state.saves[event.routeId];
      if (state.workspace.mode !== "editable" || pending?.status !== "saving" || pending.requestId !== event.requestId) return state;
      return {
        ...state,
        workspace: {
          ...state.workspace,
          generationStatus: "ready",
          routes: state.workspace.routes.map((route) => route.activityId === event.routeId
            ? { ...route, curation: pending.draft, generationStatus: "ready" }
            : route),
        },
        saves: { ...state.saves, [event.routeId]: { status: "saved" } },
      };
    }
    case "saveFailed": {
      const pending = state.saves[event.routeId];
      if (pending?.status !== "saving" || pending.requestId !== event.requestId) return state;
      return { ...state, saves: { ...state.saves, [event.routeId]: { status: "failed", message: event.message } } };
    }
    default: {
      const unhandled: never = event;
      throw new Error(`Unhandled Admin event: ${unhandled}`);
    }
  }
}

export function selectAdminWorkspace(state: AdminWorkspaceState) {
  const workspace = state.status === "ready" ? state.workspace : null;
  const query = state.status === "ready" ? state.query : "";
  const normalized = query.trim().toLowerCase();
  const matchingRoutes = (workspace?.routes ?? []).filter((route) => !normalized ||
    [route.name, route.region, route.type, route.date].some((value) => value.toLowerCase().includes(normalized)),
  );
  const selectedId = state.status === "ready" ? state.selectedId : null;
  const effectiveSelectedId = matchingRoutes.some((route) => route.activityId === selectedId)
    ? selectedId : (matchingRoutes[0]?.activityId ?? null);
  const selectedRoute = workspace?.routes.find((route) => route.activityId === effectiveSelectedId);
  const draft = selectedRoute && state.status === "ready"
    ? state.drafts[selectedRoute.activityId] ?? selectedRoute.curation : null;
  const save = selectedRoute && state.status === "ready" ? state.saves[selectedRoute.activityId] : undefined;
  const saving = save?.status === "saving";
  return {
    workspace, query, matchingRoutes, visibleRoutes: matchingRoutes.slice(0, 200),
    effectiveSelectedId, selectedRoute, draft, saving,
    dirty: Boolean(selectedRoute && draft && JSON.stringify(draft) !== JSON.stringify(selectedRoute.curation)),
    canSave: workspace?.mode === "editable" && Boolean(draft && validateCuration(draft).canSave) && !saving,
    saveMessage: save?.status === "saved" ? "Saved. Manifest and route detail regenerated."
      : save?.status === "failed" ? save.message : null,
  };
}
