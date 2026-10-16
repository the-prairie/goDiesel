export function initialMutationState() {
    return { routes: [], dirty: new Map(), save: { status: 'idle' }, refreshes: new Set(), rebuilds: new Set() };
}
export function reduceMutation(state, event) {
    switch (event.type) {
        case 'fieldEdited': {
            const dirty = new Map(state.dirty);
            dirty.set(event.routeId, { ...dirty.get(event.routeId), [event.field]: event.value });
            return { ...state, dirty };
        }
        case 'saveStarted': {
            if (state.save.status !== 'idle' || state.dirty.size === 0)
                return state;
            return { ...state, save: { status: 'saving', requestId: event.requestId, patches: state.dirty } };
        }
        case 'saveAccepted': {
            if (state.save.status !== 'saving' || state.save.requestId !== event.requestId)
                return state;
            const dirty = new Map(state.dirty);
            for (const [routeId, submitted] of state.save.patches) {
                const remaining = { ...dirty.get(routeId) };
                for (const [field, value] of Object.entries(submitted)) {
                    if (remaining[field] === value)
                        delete remaining[field];
                }
                if (Object.keys(remaining).length)
                    dirty.set(routeId, remaining);
                else
                    dirty.delete(routeId);
            }
            return { ...state, dirty, save: { status: 'refreshing', requestId: event.requestId } };
        }
        case 'saveSettled': {
            if (state.save.status === 'idle' || state.save.requestId !== event.requestId)
                return state;
            return { ...state, save: { status: 'idle' } };
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
