/** Rendering evidence and streaming progress are deliberately separate. */
export interface TerrainReadiness {
  readonly consecutiveDraws: number;
  readonly ready: boolean;
  readonly refining: boolean;
}

export const INITIAL_TERRAIN_READINESS: TerrainReadiness = {
  consecutiveDraws: 0, ready: false, refining: false,
};

/**
 * Two actual terrain draw frames release the startup deadline. Waiting for a
 * percentage of the entire streaming queue can time out a visible landscape.
 * Refinement (including a temporarily empty view after a seek) remains partial.
 * Download completion alone must never qualify an empty renderer as ready.
 */
export function advanceTerrainReadiness(
  previous: TerrainReadiness,
  renderedMeshes: number,
  loadProgress: number,
): TerrainReadiness {
  const drewTerrain = Number.isFinite(renderedMeshes) && renderedMeshes > 0;
  const consecutiveDraws = drewTerrain ? Math.min(2, previous.consecutiveDraws + 1) : 0;
  const ready = previous.ready || consecutiveDraws >= 2;
  return {
    consecutiveDraws,
    ready,
    refining: ready && (!drewTerrain || !Number.isFinite(loadProgress) || loadProgress < 0.9),
  };
}
