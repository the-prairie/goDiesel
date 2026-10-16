export function initialMutationState() {
    return { routes: [], dirty: new Map(), saves: new Map(), refreshes: new Set(), rebuilds: new Set() };
}
export function reduceMutation(state, event) {
    switch (event.type) {
        case 'fieldEdited': {
            const dirty = new Map(state.dirty);
            dirty.set(event.routeId, { ...dirty.get(event.routeId), [event.field]: event.value });
            return { ...state, dirty };
        }
        case 'saveStarted': {
            if (state.saves.has(event.requestId))
                return state;
            const saves = new Map(state.saves);
            saves.set(event.requestId, { status: 'saving', patches: state.dirty });
            return { ...state, saves };
        }
        case 'saveAccepted': {
            if (state.saves.get(event.requestId)?.status !== 'saving')
                return state;
            const saves = new Map(state.saves);
            saves.set(event.requestId, { status: 'refreshing' });
            return { ...state, dirty: new Map(), saves };
        }
        case 'saveSettled': {
            if (!state.saves.has(event.requestId))
                return state;
            const saves = new Map(state.saves);
            saves.delete(event.requestId);
            return { ...state, saves };
        }
        case 'refreshStarted':
            return { ...state, refreshes: new Set([...state.refreshes, event.requestId]) };
        case 'routesReceived':
        case 'refreshFailed': {
            if (!state.refreshes.has(event.requestId))
                return state;
            const refreshes = new Set(state.refreshes);
            refreshes.delete(event.requestId);
            return { ...state, refreshes, routes: event.type === 'routesReceived' ? event.routes : state.routes };
        }
        case 'rebuildStarted':
            return { ...state, rebuilds: new Set([...state.rebuilds, event.requestId]) };
        case 'rebuildSettled': {
            if (!state.rebuilds.has(event.requestId))
                return state;
            const rebuilds = new Set(state.rebuilds);
            rebuilds.delete(event.requestId);
            return { ...state, rebuilds };
        }
    }
}
