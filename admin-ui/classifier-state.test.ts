import { describe, expect, it } from 'vitest';
import { initialClassifierState, reduceClassifier, classifierPresentation, classifierShouldRefresh, classifierBusy } from './classifier-state.js';

const progress = (updated: number, running = true) => ({ running, total: 20, done: updated, updated, unmapped: 1 });
const checking = () => reduceClassifier(initialClassifierState(), { type: 'pollStarted', pollId: 1 });
const received = (status = progress(5)) => reduceClassifier(checking(), { type: 'statusReceived', pollId: 1, status });

describe('standalone classifier', () => {
  it('keeps the prior notice while starting and after start failure', () => {
    const idle = received({ ...progress(0, false), total: 0 });
    const starting = reduceClassifier(idle, { type: 'startRequested', requestId: 2 });
    expect(starting.start).toEqual({ phase: 'starting', requestId: 2 });
    expect(starting.notice).toEqual(idle.notice);
    expect(classifierBusy(starting)).toBe(true);
    expect(reduceClassifier(starting, { type: 'startSettled', requestId: 2 })).toEqual(idle);
  });
  it('refreshes after five additional updates and resets its threshold on reconnect', () => {
    let state = checking();
    for (const [updated, refresh, threshold] of [[4, false, 0], [5, true, 5], [9, false, 5], [10, true, 10]] as const) {
      expect(classifierShouldRefresh(state, progress(updated))).toBe(refresh);
      state = reduceClassifier(state, { type: 'statusReceived', pollId: 1, status: progress(updated) });
      expect(state.poll).toEqual({ phase: 'running', lastUpdatedCount: threshold });
    }
    state = reduceClassifier(state, { type: 'pollStarted', pollId: 2 });
    expect(classifierShouldRefresh(state, progress(5))).toBe(true);
  });
  it('renders original progress and completion counts and labels', () => {
    let state = received({ ...progress(5), last_label: 'Test valley' });
    expect(classifierPresentation(state)).toEqual({ text: '✦ CLASSIFYING 5 / 20 · Test valley', active: true });
    expect(classifierShouldRefresh(state, progress(7, false))).toBe(true);
    state = reduceClassifier(state, { type: 'statusReceived', pollId: 1, status: progress(7, false) });
    expect(state.poll.phase).toBe('complete');
    expect(classifierPresentation(state)).toEqual({ text: '✓ CLASSIFIED 7 / 20 · 1 still unmapped', active: false });
    expect(classifierPresentation(reduceClassifier(state, { type: 'noticeExpired', pollId: 1 })).text).toBe('');
  });
  it('shows empty or unmapped idle results without refreshing', () => {
    for (const unmapped of [0, 2]) {
      const status = { ...progress(0, false), total: 0, unmapped };
      expect(classifierShouldRefresh(checking(), status)).toBe(false);
      expect(classifierPresentation(received(status))).toEqual({ text: unmapped ? '2 unmapped — click AUTO-CLASSIFY' : '', active: false });
    }
  });
  it('exposes a failed check and permits a new start', () => {
    const failed = reduceClassifier(checking(), { type: 'checkFailed', pollId: 1 });
    expect(failed.poll.phase).toBe('failed');
    expect(classifierPresentation(failed)).toEqual({ text: 'CHECK FAILED', active: false });
    expect(classifierBusy(failed)).toBe(false);
    expect(reduceClassifier(failed, { type: 'startRequested', requestId: 2 }).start.phase).toBe('starting');
  });
  it('rejects duplicate starts while starting, reconnecting or running', () => {
    const starting = reduceClassifier(initialClassifierState(), { type: 'startRequested', requestId: 1 });
    for (const state of [starting, checking(), received()]) {
      expect(reduceClassifier(state, { type: 'startRequested', requestId: 3 })).toBe(state);
      expect(classifierBusy(state)).toBe(true);
    }
    expect(reduceClassifier(starting, { type: 'startSettled', requestId: 2 })).toBe(starting);
  });
  it('ignores stale checks and outcomes after settlement', () => {
    for (const state of [checking(), received(), received(progress(20, false))]) {
      expect(reduceClassifier(state, { type: 'statusReceived', pollId: 0, status: progress(0, false) })).toBe(state);
      expect(reduceClassifier(state, { type: 'checkFailed', pollId: 0 })).toBe(state);
      expect(reduceClassifier(state, { type: 'pollStarted', pollId: 1 })).toBe(state);
    }
    const complete = received(progress(20, false));
    expect(reduceClassifier(complete, { type: 'statusReceived', pollId: 1, status: progress(2) })).toBe(complete);
    expect(reduceClassifier(complete, { type: 'checkFailed', pollId: 1 })).toBe(complete);
  });
  it('does not expire notices belonging to a newer run or a pending start', () => {
    const complete = received(progress(20, false));
    const starting = reduceClassifier(complete, { type: 'startRequested', requestId: 2 });
    expect(reduceClassifier(starting, { type: 'noticeExpired', pollId: 1 })).toBe(starting);
    const restarted = reduceClassifier(complete, { type: 'pollStarted', pollId: 2 });
    const running = reduceClassifier(restarted, { type: 'statusReceived', pollId: 2, status: progress(1) });
    expect(reduceClassifier(running, { type: 'noticeExpired', pollId: 1 })).toBe(running);
    expect(reduceClassifier(running, { type: 'noticeExpired', pollId: 2 })).toBe(running);
  });
});
