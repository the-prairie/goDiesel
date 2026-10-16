import { describe, expect, it } from 'vitest';
import { initialMutationState, reduceMutation } from './mutation-state.js';

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
      { type: 'rebuildSettled', requestId: 7 },
    ] as const) expect(reduceMutation(initial, event)).toBe(initial);
  });
  it('prevents duplicate saves while refreshes and rebuilds remain independent', () => {
    let state = edit();
    state = reduceMutation(state, { type: 'saveStarted', requestId: 1 });
    state = reduceMutation(state, { type: 'saveStarted', requestId: 2 });
    state = reduceMutation(state, { type: 'refreshStarted', requestId: 3 });
    state = reduceMutation(state, { type: 'rebuildStarted', requestId: 4 });
    state = reduceMutation(state, { type: 'saveSettled', requestId: 1 });
    expect(state.save).toEqual({ status: 'idle' });
    expect([...state.refreshes]).toEqual([3]);
    expect([...state.rebuilds]).toEqual([4]);
  });
  it('retains completion-order route refresh policy and drafts', () => {
    let state = edit();
    state = reduceMutation(state, { type: 'refreshStarted', requestId: 1 });
    state = reduceMutation(state, { type: 'refreshStarted', requestId: 2 });
    state = reduceMutation(state, { type: 'routesReceived', requestId: 2, routes: [{ activity_id: 'newer' }] });
    state = reduceMutation(state, { type: 'routesReceived', requestId: 1, routes: [{ activity_id: 'older' }] });
    expect(state.routes).toEqual([{ activity_id: 'older' }]);
    expect(state.dirty.get('one')).toEqual({ title: 'Draft' });
    expect(state.refreshes.size).toBe(0);
  });
  it('settles refresh failure without losing last routes and settles rebuild independently', () => {
    let state = reduceMutation(initialMutationState(), { type: 'refreshStarted', requestId: 1 });
    state = reduceMutation(state, { type: 'routesReceived', requestId: 1, routes: [{ activity_id: 'one' }] });
    state = reduceMutation(state, { type: 'refreshStarted', requestId: 2 });
    state = reduceMutation(state, { type: 'rebuildStarted', requestId: 3 });
    state = reduceMutation(state, { type: 'refreshFailed', requestId: 2 });
    state = reduceMutation(state, { type: 'rebuildSettled', requestId: 3 });
    expect(state.routes).toEqual([{ activity_id: 'one' }]);
    expect(state.refreshes.size).toBe(0);
    expect(state.rebuilds.size).toBe(0);
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
