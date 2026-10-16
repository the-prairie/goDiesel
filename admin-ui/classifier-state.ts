export type ClassifierStatus = {
  running: boolean;
  total: number;
  done: number;
  updated: number;
  unmapped?: number;
  last_label?: string;
};

type ClassifierNotice =
  | { kind: 'empty' }
  | { kind: 'unmapped'; count: number }
  | { kind: 'running'; progress: ClassifierStatus }
  | { kind: 'complete'; progress: ClassifierStatus }
  | { kind: 'failed' };

export type ClassifierState = {
  start: { phase: 'idle' } | { phase: 'starting'; requestId: number };
  pollId: number;
  poll:
    | { phase: 'idle' | 'checking' | 'failed' }
    | { phase: 'running'; lastUpdatedCount: number }
    | { phase: 'complete' };
  notice: ClassifierNotice;
};

export type ClassifierEvent =
  | { type: 'startRequested'; requestId: number }
  | { type: 'startSettled'; requestId: number }
  | { type: 'pollStarted'; pollId: number }
  | { type: 'statusReceived'; pollId: number; status: ClassifierStatus }
  | { type: 'checkFailed'; pollId: number }
  | { type: 'noticeExpired'; pollId: number };

export function initialClassifierState(): ClassifierState {
  return { start: { phase: 'idle' }, pollId: 0, poll: { phase: 'idle' }, notice: { kind: 'empty' } };
}

export function classifierShouldRefresh(state: ClassifierState, status: ClassifierStatus): boolean {
  const lastUpdatedCount = state.poll.phase === 'running' ? state.poll.lastUpdatedCount : 0;
  return status.running ? status.updated > lastUpdatedCount + 4 : status.total > 0;
}

export function reduceClassifier(state: ClassifierState, event: ClassifierEvent): ClassifierState {
  switch (event.type) {
    case 'startRequested':
      if (classifierBusy(state)) return state;
      return { ...state, start: { phase: 'starting', requestId: event.requestId } };
    case 'startSettled':
      if (state.start.phase !== 'starting' || state.start.requestId !== event.requestId) return state;
      return { ...state, start: { phase: 'idle' } };
    case 'pollStarted':
      if (event.pollId <= state.pollId) return state;
      return { ...state, pollId: event.pollId, poll: { phase: 'checking' } };
    case 'checkFailed':
      if (!classifierAcceptsStatus(state, event.pollId)) return state;
      return { ...state, poll: { phase: 'failed' }, notice: { kind: 'failed' } };
    case 'noticeExpired':
      if (state.pollId !== event.pollId || state.poll.phase !== 'complete' || state.start.phase !== 'idle') return state;
      return { ...state, notice: { kind: 'empty' } };
    case 'statusReceived': {
      if (!classifierAcceptsStatus(state, event.pollId)) return state;
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

export function classifierPresentation(state: ClassifierState): { text: string; active: boolean } {
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

export function classifierBusy(state: ClassifierState): boolean {
  return state.start.phase === 'starting' || state.poll.phase === 'checking' || state.poll.phase === 'running';
}

export function classifierAcceptsStatus(state: ClassifierState, pollId: number): boolean {
  return state.pollId === pollId && (state.poll.phase === 'checking' || state.poll.phase === 'running');
}
