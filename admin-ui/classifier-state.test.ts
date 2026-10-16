import { describe, expect, it } from 'vitest';
import { initialClassifierState, reduceClassifier, classifierPresentation, classifierShouldRefresh } from './classifier-state.js';

const progress = (updated: number, running = true) => ({ running, total: 20, done: updated, updated, unmapped: 1 });

describe('standalone classifier', () => {
  it('keeps the prior notice while starting and after start failure', () => {
    const idle = reduceClassifier(initialClassifierState(), { type: 'statusReceived', status: { ...progress(0, false), total: 0 } });
    const starting = reduceClassifier(idle, { type: 'startRequested' });
    expect(starting.start).toBe('starting');
    expect(starting.notice).toEqual(idle.notice);
    expect(reduceClassifier(starting, { type: 'startSettled' })).toEqual(idle);
  });
  it('refreshes after five additional updates and preserves the threshold between observations', () => {
    let state = initialClassifierState();
    for (const [updated, refresh, threshold] of [[4, false, 0], [5, true, 5], [9, false, 5], [10, true, 10]] as const) {
      expect(classifierShouldRefresh(state, progress(updated))).toBe(refresh);
      state = reduceClassifier(state, { type: 'statusReceived', status: progress(updated) });
      expect(state.poll).toEqual({ phase: 'running', lastUpdatedCount: threshold });
    }
    state = reduceClassifier(state, { type: 'pollStarted' });
    expect(classifierShouldRefresh(state, progress(5))).toBe(true);
  });
  it('renders progress and completion with their original counts and labels', () => {
    let state = reduceClassifier(initialClassifierState(), { type: 'statusReceived', status: { ...progress(5), last_label: 'Test valley' } });
    expect(classifierPresentation(state)).toEqual({ text: '✦ CLASSIFYING 5 / 20 · Test valley', active: true });
    expect(classifierShouldRefresh(state, progress(7, false))).toBe(true);
    state = reduceClassifier(state, { type: 'statusReceived', status: progress(7, false) });
    expect(state.poll.phase).toBe('complete');
    expect(classifierPresentation(state)).toEqual({ text: '✓ CLASSIFIED 7 / 20 · 1 still unmapped', active: false });
    expect(classifierPresentation(reduceClassifier(state, { type: 'noticeExpired' })).text).toBe('');
  });
  it('shows empty or unmapped idle results without refreshing', () => {
    for (const unmapped of [0, 2]) {
      const status = { ...progress(0, false), total: 0, unmapped };
      expect(classifierShouldRefresh(initialClassifierState(), status)).toBe(false);
      const state = reduceClassifier(initialClassifierState(), { type: 'statusReceived', status });
      expect(classifierPresentation(state)).toEqual({ text: unmapped ? '2 unmapped — click AUTO-CLASSIFY' : '', active: false });
    }
  });
  it('exposes a failed check and restarts its refresh threshold', () => {
    const failed = reduceClassifier(initialClassifierState(), { type: 'checkFailed' });
    expect(failed.poll.phase).toBe('failed');
    expect(classifierPresentation(failed)).toEqual({ text: 'CHECK FAILED', active: false });
    expect(reduceClassifier(failed, { type: 'pollStarted' }).poll.phase).toBe('checking');
  });
});
