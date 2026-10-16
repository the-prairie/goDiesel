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
    expect(failed.saves.size).toBe(0);
  });
  it('pins existing save acceptance clearing drafts before refresh', () => {
    const pending = reduceMutation(edit(), { type: 'saveStarted', requestId: 1 });
    const accepted = reduceMutation(edit(pending, 'Newer'), { type: 'saveAccepted', requestId: 1 });
    expect(accepted.dirty.size).toBe(0);
    expect(accepted.saves.get(1)).toEqual({ status: 'refreshing' });
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
  it('allows independent saves, refreshes and rebuilds without replacing other work', () => {
    let state = edit();
    state = reduceMutation(state, { type: 'saveStarted', requestId: 1 });
    state = reduceMutation(state, { type: 'saveStarted', requestId: 2 });
    state = reduceMutation(state, { type: 'refreshStarted', requestId: 3 });
    state = reduceMutation(state, { type: 'rebuildStarted', requestId: 4 });
    state = reduceMutation(state, { type: 'saveSettled', requestId: 1 });
    expect([...state.saves.keys()]).toEqual([2]);
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
});
