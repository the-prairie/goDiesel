import { describe, expect, it } from 'vitest';
import { initialMutationState, reduceMutation, rebuildBusy, rebuildPresentation, type MutationState, type RebuildSnapshot } from './mutation-state.js';

const edit = (state = initialMutationState(), value = 'Draft') => reduceMutation(state, { type: 'fieldEdited', routeId: 'one', field: 'title', value });

describe('standalone admin mutations', () => {
  it('keeps immutable route patches and combines edited fields', () => {
    const first = edit();
    const next = reduceMutation(first, { type: 'fieldEdited', routeId: 'one', field: 'blurb', value: 'Two lines\nretained' });
    expect(first.dirty.get('one')).toEqual({ title: 'Draft' });
    expect(next.dirty.get('one')).toEqual({ title: 'Draft', blurb: 'Two lines\nretained' });
  });
  it('retains patches after a failed save for retry', () => {
    const pending = reduceMutation(edit(), { type: 'saveStarted', requestId: 1 });
    const failed = reduceMutation(pending, { type: 'saveSettled', requestId: 1 });
    expect(failed.dirty.get('one')).toEqual({ title: 'Draft' });
    expect(failed.save.status).toBe('idle');
  });
  it('retains newer edits and clears only submitted values before refresh', () => {
    const pending = reduceMutation(edit(), { type: 'saveStarted', requestId: 1 });
    const accepted = reduceMutation(edit(pending, 'Newer'), { type: 'saveAccepted', requestId: 1 });
    expect(accepted.dirty.get('one')).toEqual({ title: 'Newer' });
    expect(accepted.save).toEqual({ status: 'refreshing', requestId: 1 });
    expect(reduceMutation(accepted, { type: 'saveAccepted', requestId: 1 })).toBe(accepted);
  });
  it('ignores unknown and already settled outcomes', () => {
    const initial = edit();
    for (const event of [
      { type: 'saveAccepted', requestId: 7 }, { type: 'saveSettled', requestId: 7 },
      { type: 'routesReceived', requestId: 7, routes: [] }, { type: 'refreshFailed', requestId: 7 },
      { type: 'rebuildAccepted', requestId: 7, rebuild: null }, { type: 'rebuildRefused', requestId: 7 },
      { type: 'rebuildNoticeExpired', id: 'unknown' },
    ] as const) expect(reduceMutation(initial, event)).toBe(initial);
  });
  it('prevents duplicate saves while refreshes and rebuilds remain independent', () => {
    let state = edit();
    state = reduceMutation(state, { type: 'saveStarted', requestId: 1 });
    state = reduceMutation(state, { type: 'saveStarted', requestId: 2 });
    state = reduceMutation(state, { type: 'refreshStarted', requestId: 3 });
    state = reduceMutation(state, { type: 'rebuildRequested', requestId: 4 });
    state = reduceMutation(state, { type: 'saveSettled', requestId: 1 });
    expect(state.save).toEqual({ status: 'idle' });
    expect([...state.refreshes]).toEqual([3]);
    expect(state.rebuild).toEqual({ phase: 'starting', requestId: 4 });
  });
  it('keeps the latest-started route refresh and drops an older result that lands after it', () => {
    let state = edit();
    state = reduceMutation(state, { type: 'refreshStarted', requestId: 1 });
    state = reduceMutation(state, { type: 'refreshStarted', requestId: 2 });
    state = reduceMutation(state, { type: 'routesReceived', requestId: 2, routes: [{ activity_id: 'newer' }] });
    const settled = state;
    state = reduceMutation(state, { type: 'routesReceived', requestId: 1, routes: [{ activity_id: 'older' }] });
    expect(state.routes).toEqual([{ activity_id: 'newer' }]);
    expect(state.dirty.get('one')).toEqual({ title: 'Draft' });
    expect(state.refreshes.size).toBe(0);
    expect(reduceMutation(state, { type: 'routesReceived', requestId: 1, routes: [] })).toBe(state);
    expect(settled.refreshes).toEqual(new Set([1]));
  });
  it('drops an older refresh result even when it lands before the latest-started one', () => {
    let state = reduceMutation(initialMutationState(), { type: 'refreshStarted', requestId: 1 });
    state = reduceMutation(state, { type: 'routesReceived', requestId: 1, routes: [{ activity_id: 'first' }] });
    state = reduceMutation(state, { type: 'refreshStarted', requestId: 2 });
    state = reduceMutation(state, { type: 'refreshStarted', requestId: 3 });
    state = reduceMutation(state, { type: 'routesReceived', requestId: 2, routes: [{ activity_id: 'pre-save' }] });
    expect(state.routes).toEqual([{ activity_id: 'first' }]);
    state = reduceMutation(state, { type: 'routesReceived', requestId: 3, routes: [{ activity_id: 'post-save' }] });
    expect(state.routes).toEqual([{ activity_id: 'post-save' }]);
    expect(state.refreshes.size).toBe(0);
  });
  it('keeps the last accepted routes when the latest-started refresh fails', () => {
    let state = reduceMutation(initialMutationState(), { type: 'refreshStarted', requestId: 1 });
    state = reduceMutation(state, { type: 'refreshStarted', requestId: 2 });
    state = reduceMutation(state, { type: 'routesReceived', requestId: 1, routes: [{ activity_id: 'older' }] });
    state = reduceMutation(state, { type: 'refreshFailed', requestId: 2 });
    expect(state.routes).toEqual([]);
    expect(state.refreshes.size).toBe(0);
  });
  it('settles refresh failure without losing last routes and settles rebuild independently', () => {
    let state = reduceMutation(initialMutationState(), { type: 'refreshStarted', requestId: 1 });
    state = reduceMutation(state, { type: 'routesReceived', requestId: 1, routes: [{ activity_id: 'one' }] });
    state = reduceMutation(state, { type: 'refreshStarted', requestId: 2 });
    state = reduceMutation(state, { type: 'rebuildRequested', requestId: 3 });
    state = reduceMutation(state, { type: 'refreshFailed', requestId: 2 });
    state = reduceMutation(state, { type: 'rebuildRefused', requestId: 3 });
    expect(state.routes).toEqual([{ activity_id: 'one' }]);
    expect(state.refreshes.size).toBe(0);
    expect(state.rebuild).toEqual({ phase: 'idle' });
  });
  it('clears submitted fields while retaining new fields and other route edits', () => {
    let state = reduceMutation(edit(), { type: 'saveStarted', requestId: 1 });
    state = reduceMutation(state, { type: 'fieldEdited', routeId: 'one', field: 'blurb', value: 'Added later' });
    state = reduceMutation(state, { type: 'fieldEdited', routeId: 'two', field: 'title', value: 'Another route' });
    state = reduceMutation(state, { type: 'saveAccepted', requestId: 1 });
    expect([...state.dirty]).toEqual([['one', { blurb: 'Added later' }], ['two', { title: 'Another route' }]]);
  });
  it('rejects duplicate saves through refresh and accepts a retry after settlement', () => {
    const pending = reduceMutation(edit(), { type: 'saveStarted', requestId: 1 });
    expect(reduceMutation(pending, { type: 'saveStarted', requestId: 2 })).toBe(pending);
    expect(reduceMutation(pending, { type: 'saveAccepted', requestId: 2 })).toBe(pending);
    const accepted = reduceMutation(edit(pending, 'Newer'), { type: 'saveAccepted', requestId: 1 });
    expect(reduceMutation(accepted, { type: 'saveStarted', requestId: 2 })).toBe(accepted);
    const settled = reduceMutation(accepted, { type: 'saveSettled', requestId: 1 });
    const retry = reduceMutation(settled, { type: 'saveStarted', requestId: 2 });
    expect(retry.save).toEqual({ status: 'saving', requestId: 2, patches: new Map([['one', { title: 'Newer' }]]) });
  });

});

const snapshot = (phase: RebuildSnapshot['phase'], id: string | null = 'run-a', extra: Partial<RebuildSnapshot> = {}): RebuildSnapshot =>
  ({ phase, id, started_at: phase === 'idle' ? null : 1, finished_at: null, exit_code: null, stderr_tail: null, ...extra });
const rebuildEvent = (state: MutationState, event: Parameters<typeof reduceMutation>[1]) => reduceMutation(state, event);
const requested = () => rebuildEvent(initialMutationState(), { type: 'rebuildRequested', requestId: 1 });
const running = () => rebuildEvent(requested(), { type: 'rebuildAccepted', requestId: 1, rebuild: snapshot('running') });

describe('standalone admin rebuild lifecycle', () => {
  it('starts idle, shows nothing and leaves the control enabled', () => {
    const state = initialMutationState();
    expect(state.rebuild).toEqual({ phase: 'idle' });
    expect(rebuildBusy(state.rebuild)).toBe(false);
    expect(rebuildPresentation(state.rebuild)).toEqual({ text: '', active: false, failed: false, detail: null });
  });
  it('moves through starting and running and disables the control', () => {
    const starting = requested();
    expect(starting.rebuild).toEqual({ phase: 'starting', requestId: 1 });
    expect(rebuildBusy(starting.rebuild)).toBe(true);
    expect(rebuildPresentation(starting.rebuild)).toEqual({ text: '↻ STARTING REBUILD…', active: true, failed: false, detail: null });
    const state = running();
    expect(state.rebuild).toEqual({ phase: 'running', id: 'run-a' });
    expect(rebuildBusy(state.rebuild)).toBe(true);
    expect(rebuildPresentation(state.rebuild)).toEqual({ text: '↻ REBUILDING SITE · run-a', active: true, failed: false, detail: null });
  });
  it('rejects a second request while starting or running', () => {
    for (const state of [requested(), running()]) {
      expect(rebuildEvent(state, { type: 'rebuildRequested', requestId: 9 })).toBe(state);
    }
  });
  it('settles a tracked run as succeeded, then lets the notice expire', () => {
    const succeeded = rebuildEvent(running(), { type: 'rebuildStatusReceived', rebuild: snapshot('succeeded', 'run-a', { finished_at: 2 }) });
    expect(succeeded.rebuild).toEqual({ phase: 'succeeded', id: 'run-a' });
    expect(rebuildBusy(succeeded.rebuild)).toBe(false);
    expect(rebuildPresentation(succeeded.rebuild)).toEqual({ text: '✓ SITE REBUILT · run-a', active: false, failed: false, detail: null });
    expect(rebuildEvent(succeeded, { type: 'rebuildNoticeExpired', id: 'run-b' })).toBe(succeeded);
    expect(rebuildEvent(succeeded, { type: 'rebuildNoticeExpired', id: 'run-a' }).rebuild).toEqual({ phase: 'idle' });
  });
  it('settles a tracked run as failed with its exit code and stderr tail on demand', () => {
    const failed = rebuildEvent(running(), { type: 'rebuildStatusReceived',
      rebuild: snapshot('failed', 'run-a', { finished_at: 2, exit_code: 2, stderr_tail: 'Traceback\nValueError: bad route' }) });
    expect(failed.rebuild).toEqual({ phase: 'failed', id: 'run-a', exitCode: 2, stderrTail: 'Traceback\nValueError: bad route' });
    expect(rebuildPresentation(failed.rebuild)).toEqual({
      text: '✕ REBUILD FAILED · EXIT 2 · run-a', active: false, failed: true, detail: 'Traceback\nValueError: bad route' });
    expect(rebuildEvent(failed, { type: 'rebuildNoticeExpired', id: 'run-a' })).toBe(failed);
    const retry = rebuildEvent(failed, { type: 'rebuildRequested', requestId: 2 });
    expect(retry.rebuild).toEqual({ phase: 'starting', requestId: 2 });
  });
  it('reports a failure without an exit code or stderr', () => {
    const failed = rebuildEvent(running(), { type: 'rebuildStatusReceived', rebuild: snapshot('failed', 'run-a', { stderr_tail: '' }) });
    expect(rebuildPresentation(failed.rebuild)).toEqual({ text: '✕ REBUILD FAILED · NO EXIT CODE · run-a', active: false, failed: true, detail: null });
  });
  it('treats a server that no longer knows the tracked run as a failure without exit code', () => {
    const lost = rebuildEvent(running(), { type: 'rebuildStatusReceived', rebuild: snapshot('idle', null) });
    expect(lost.rebuild).toEqual({ phase: 'failed', id: 'run-a', exitCode: null, stderrTail: '' });
  });
  it('ignores status for a different run while tracking one, and a still-running status', () => {
    const state = running();
    for (const rebuild of [snapshot('running'), snapshot('succeeded', 'run-b'), snapshot('failed', 'run-b', { exit_code: 1 }), snapshot('running', 'run-b')]) {
      expect(rebuildEvent(state, { type: 'rebuildStatusReceived', rebuild })).toBe(state);
    }
  });
  it('adopts a rebuild that is already running when nothing is tracked, as on page load', () => {
    const adopted = rebuildEvent(initialMutationState(), { type: 'rebuildStatusReceived', rebuild: snapshot('running', 'run-z') });
    expect(adopted.rebuild).toEqual({ phase: 'running', id: 'run-z' });
    const idle = initialMutationState();
    for (const rebuild of [snapshot('idle', null), snapshot('succeeded', 'run-z'), snapshot('failed', 'run-z', { exit_code: 1 })]) {
      expect(rebuildEvent(idle, { type: 'rebuildStatusReceived', rebuild })).toBe(idle);
    }
  });
  it('does not adopt another run over a pending start or a settled notice', () => {
    const starting = requested();
    expect(rebuildEvent(starting, { type: 'rebuildStatusReceived', rebuild: snapshot('running', 'run-z') })).toBe(starting);
    const succeeded = rebuildEvent(running(), { type: 'rebuildStatusReceived', rebuild: snapshot('succeeded') });
    expect(rebuildEvent(succeeded, { type: 'rebuildStatusReceived', rebuild: snapshot('running', 'run-z') })).toBe(succeeded);
  });
  it('accepts only the matching start outcome', () => {
    const starting = requested();
    expect(rebuildEvent(starting, { type: 'rebuildAccepted', requestId: 2, rebuild: snapshot('running') })).toBe(starting);
    expect(rebuildEvent(starting, { type: 'rebuildRefused', requestId: 2 })).toBe(starting);
    expect(rebuildEvent(starting, { type: 'rebuildRefused', requestId: 1 }).rebuild).toEqual({ phase: 'idle' });
    const settled = running();
    expect(rebuildEvent(settled, { type: 'rebuildAccepted', requestId: 1, rebuild: snapshot('succeeded') })).toBe(settled);
  });
  it('returns to idle for a server whose start response has no rebuild snapshot', () => {
    expect(rebuildEvent(requested(), { type: 'rebuildAccepted', requestId: 1, rebuild: null }).rebuild).toEqual({ phase: 'idle' });
  });
  it('keeps the rebuild lifecycle independent of drafts and saves', () => {
    let state = rebuildEvent(running(), { type: 'fieldEdited', routeId: 'one', field: 'title', value: 'Draft' });
    state = rebuildEvent(state, { type: 'saveStarted', requestId: 2 });
    expect(state.rebuild).toEqual({ phase: 'running', id: 'run-a' });
    state = rebuildEvent(state, { type: 'saveSettled', requestId: 2 });
    expect(state.dirty.get('one')).toEqual({ title: 'Draft' });
  });
});
