export function initialMutationState() {
    return { routes: [], dirty: new Map(), save: { status: 'idle' }, refreshes: new Set(), latestRefreshId: 0, rebuild: { phase: 'idle' } };
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
            return { ...state, refreshes: new Set([...state.refreshes, event.requestId]),
                latestRefreshId: Math.max(state.latestRefreshId, event.requestId) };
        case 'routesReceived':
        case 'refreshFailed': {
            if (!state.refreshes.has(event.requestId))
                return state;
            const refreshes = new Set(state.refreshes);
            refreshes.delete(event.requestId);
            // The latest-started refresh wins. An older result describes routes from
            // before a later save, so it is dropped even if it lands first.
            const accept = event.type === 'routesReceived' && event.requestId === state.latestRefreshId;
            return { ...state, refreshes, routes: accept ? event.routes : state.routes };
        }
        case 'rebuildRequested':
        case 'rebuildAccepted':
        case 'rebuildRefused':
        case 'rebuildStatusReceived':
        case 'rebuildNoticeExpired': {
            const rebuild = reduceRebuild(state.rebuild, event);
            return rebuild === state.rebuild ? state : { ...state, rebuild };
        }
    }
}
function settledRebuild(snapshot, id) {
    if (snapshot.phase === 'succeeded')
        return { phase: 'succeeded', id };
    if (snapshot.phase === 'failed') {
        return { phase: 'failed', id, exitCode: snapshot.exit_code ?? null, stderrTail: snapshot.stderr_tail ?? '' };
    }
    return null;
}
function reduceRebuild(state, event) {
    switch (event.type) {
        case 'rebuildRequested':
            if (rebuildBusy(state))
                return state;
            return { phase: 'starting', requestId: event.requestId };
        case 'rebuildRefused':
            if (state.phase !== 'starting' || state.requestId !== event.requestId)
                return state;
            return { phase: 'idle' };
        case 'rebuildAccepted': {
            if (state.phase !== 'starting' || state.requestId !== event.requestId)
                return state;
            const snapshot = event.rebuild;
            // A server without the rebuild snapshot gives no outcome to follow.
            if (!snapshot || !snapshot.id)
                return { phase: 'idle' };
            if (snapshot.phase === 'running')
                return { phase: 'running', id: snapshot.id };
            return settledRebuild(snapshot, snapshot.id) ?? { phase: 'idle' };
        }
        case 'rebuildStatusReceived': {
            const snapshot = event.rebuild;
            // Adopt a run that was already going when nothing is tracked: the page
            // loaded mid-rebuild, or a start was refused because one holds the lock.
            if (state.phase === 'idle') {
                return snapshot.phase === 'running' && snapshot.id ? { phase: 'running', id: snapshot.id } : state;
            }
            if (state.phase !== 'running')
                return state;
            // The server forgot every run, so the tracked one can never report.
            if (snapshot.phase === 'idle')
                return { phase: 'failed', id: state.id, exitCode: null, stderrTail: '' };
            if (snapshot.id !== state.id)
                return state;
            return settledRebuild(snapshot, state.id) ?? state;
        }
        case 'rebuildNoticeExpired':
            if (state.phase !== 'succeeded' || state.id !== event.id)
                return state;
            return { phase: 'idle' };
    }
}
export function rebuildBusy(state) {
    return state.phase === 'starting' || state.phase === 'running';
}
export function rebuildPresentation(state) {
    switch (state.phase) {
        case 'idle': return { text: '', active: false, failed: false, detail: null };
        case 'starting': return { text: '↻ STARTING REBUILD…', active: true, failed: false, detail: null };
        case 'running': return { text: `↻ REBUILDING SITE · ${state.id}`, active: true, failed: false, detail: null };
        case 'succeeded': return { text: `✓ SITE REBUILT · ${state.id}`, active: false, failed: false, detail: null };
        case 'failed': return {
            text: `✕ REBUILD FAILED · ${state.exitCode === null ? 'NO EXIT CODE' : `EXIT ${state.exitCode}`} · ${state.id}`,
            active: false, failed: true, detail: state.stderrTail || null,
        };
    }
}
