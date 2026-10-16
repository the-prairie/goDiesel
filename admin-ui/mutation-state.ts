export type AdminRoute = { activity_id: string; [field: string]: unknown };
export type RoutePatch = Record<string, string>;
type SaveOperation =
  | { status: 'saving'; patches: ReadonlyMap<string, RoutePatch> }
  | { status: 'refreshing' };

export type MutationState = {
  routes: AdminRoute[];
  dirty: ReadonlyMap<string, RoutePatch>;
  saves: ReadonlyMap<number, SaveOperation>;
  refreshes: ReadonlySet<number>;
  rebuilds: ReadonlySet<number>;
};

export type MutationEvent =
  | { type: 'fieldEdited'; routeId: string; field: string; value: string }
  | { type: 'saveStarted'; requestId: number }
  | { type: 'saveAccepted'; requestId: number }
  | { type: 'saveSettled'; requestId: number }
  | { type: 'refreshStarted'; requestId: number }
  | { type: 'routesReceived'; requestId: number; routes: AdminRoute[] }
  | { type: 'refreshFailed'; requestId: number }
  | { type: 'rebuildStarted'; requestId: number }
  | { type: 'rebuildSettled'; requestId: number };

export function initialMutationState(): MutationState {
  return { routes: [], dirty: new Map(), saves: new Map(), refreshes: new Set(), rebuilds: new Set() };
}

export function reduceMutation(state: MutationState, event: MutationEvent): MutationState {
  switch (event.type) {
    case 'fieldEdited': {
      const dirty = new Map(state.dirty);
      dirty.set(event.routeId, { ...dirty.get(event.routeId), [event.field]: event.value });
      return { ...state, dirty };
    }
    case 'saveStarted': {
      if (state.saves.has(event.requestId)) return state;
      const saves = new Map(state.saves);
      saves.set(event.requestId, { status: 'saving', patches: state.dirty });
      return { ...state, saves };
    }
    case 'saveAccepted': {
      if (state.saves.get(event.requestId)?.status !== 'saving') return state;
      const saves = new Map(state.saves);
      saves.set(event.requestId, { status: 'refreshing' });
      return { ...state, dirty: new Map(), saves };
    }
    case 'saveSettled': {
      if (!state.saves.has(event.requestId)) return state;
      const saves = new Map(state.saves);
      saves.delete(event.requestId);
      return { ...state, saves };
    }
    case 'refreshStarted':
      return { ...state, refreshes: new Set([...state.refreshes, event.requestId]) };
    case 'routesReceived':
    case 'refreshFailed': {
      if (!state.refreshes.has(event.requestId)) return state;
      const refreshes = new Set(state.refreshes);
      refreshes.delete(event.requestId);
      return { ...state, refreshes, routes: event.type === 'routesReceived' ? event.routes : state.routes };
    }
    case 'rebuildStarted':
      return { ...state, rebuilds: new Set([...state.rebuilds, event.requestId]) };
    case 'rebuildSettled': {
      if (!state.rebuilds.has(event.requestId)) return state;
      const rebuilds = new Set(state.rebuilds);
      rebuilds.delete(event.requestId);
      return { ...state, rebuilds };
    }
  }
}
