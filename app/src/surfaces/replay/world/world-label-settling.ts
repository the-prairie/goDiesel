interface SettledAnnotation { ready: boolean; }
interface SettlingManager {
  _settleItem(item: SettledAnnotation): Generator<unknown, void, unknown>;
}
interface AnnotationPlugin {
  settlingManager: SettlingManager;
  occupancy: { needsUpdate: boolean };
}

/**
 * Pinned 3d-tiles-renderer 0.5.2 compatibility boundary.
 * Its settling queue removes an item before its generator finishes. If settling
 * spans frames, hasPendingWork becomes false before the final positions commit,
 * so a static camera never gets another label layout. Wake layout on completion,
 * retaining the generator's yields and frame budget. No global prototype patch.
 */
export function observeWorldLabelSettling(plugin: object): () => void {
  const candidate = plugin as Partial<AnnotationPlugin>;
  const manager = candidate.settlingManager;
  const occupancy = candidate.occupancy;
  if (!manager || typeof manager._settleItem !== "function" ||
      !occupancy || !("needsUpdate" in occupancy)) {
    throw new Error("MVT settling contract changed; review the pinned adapter.");
  }
  const original = manager._settleItem;
  let active = true;
  const wrapped = function* (this: SettlingManager, item: SettledAnnotation) {
    yield* original.call(this, item);
    if (active && item.ready) occupancy.needsUpdate = true;
  };
  manager._settleItem = wrapped;
  return () => {
    active = false;
    if (manager._settleItem === wrapped) manager._settleItem = original;
  };
}
