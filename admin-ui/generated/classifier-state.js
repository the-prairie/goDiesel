export function initialClassifierState() {
    return { start: 'idle', poll: { phase: 'idle' }, notice: { kind: 'empty' } };
}
export function classifierShouldRefresh(state, status) {
    const lastUpdatedCount = state.poll.phase === 'running' ? state.poll.lastUpdatedCount : 0;
    return status.running ? status.updated > lastUpdatedCount + 4 : status.total > 0;
}
export function reduceClassifier(state, event) {
    switch (event.type) {
        case 'startRequested':
            return { ...state, start: 'starting' };
        case 'startSettled':
            return { ...state, start: 'idle' };
        case 'pollStarted':
            return { ...state, poll: { phase: 'checking' } };
        case 'checkFailed':
            return { ...state, poll: { phase: 'failed' }, notice: { kind: 'failed' } };
        case 'noticeExpired':
            return { ...state, notice: { kind: 'empty' } };
        case 'statusReceived': {
            const status = event.status;
            if (status.running) {
                const previous = state.poll.phase === 'running' ? state.poll.lastUpdatedCount : 0;
                return { ...state,
                    poll: { phase: 'running', lastUpdatedCount: classifierShouldRefresh(state, status) ? status.updated : previous },
                    notice: { kind: 'running', progress: status },
                };
            }
            return { ...state, poll: { phase: 'complete' }, notice: status.total > 0
                    ? { kind: 'complete', progress: status }
                    : status.unmapped ? { kind: 'unmapped', count: status.unmapped } : { kind: 'empty' } };
        }
    }
}
export function classifierPresentation(state) {
    const notice = state.notice;
    switch (notice.kind) {
        case 'empty': return { text: '', active: false };
        case 'failed': return { text: 'CHECK FAILED', active: false };
        case 'unmapped': return { text: `${notice.count} unmapped — click AUTO-CLASSIFY`, active: false };
        case 'running': return { text: `✦ CLASSIFYING ${notice.progress.done} / ${notice.progress.total}` +
                (notice.progress.last_label ? ` · ${notice.progress.last_label}` : ''), active: true };
        case 'complete': return { text: `✓ CLASSIFIED ${notice.progress.updated} / ${notice.progress.total}` +
                (notice.progress.unmapped ? ` · ${notice.progress.unmapped} still unmapped` : ''), active: false };
    }
}
