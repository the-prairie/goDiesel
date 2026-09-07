import type { WorldViewCoverage } from "./world-view-health";

/**
 * Establish a drawable coarse frontier before asking the library to replace it
 * with fine children. With loadAncestors=false, jumping straight to the final
 * screen error requests isolated fine leaves and leaves the rest of a new view
 * empty. Once a parent has actually been selected, the pinned traversal retains
 * it until its replacement children are ready. No invented or duplicate terrain.
 *
 * This is a temporary selection schedule, NOT a change to the selected quality.
 * The nominal target is always restored, and diagnostics expose both targets.
 */
export class WorldRefinement {
  private target: number;
  private selection: number;
  private coveredSince: number | null = null;
  private missingSince: number | null = null;
  private stage: "coverage" | "detail" | "settled" = "coverage";
  private resets = 0;

  constructor(targetPx: number) {
    this.target = this.validate(targetPx);
    this.selection = this.coarseTarget();
  }
  private validate(value: number) {
    if (!Number.isFinite(value) || value <= 0) throw new Error("Positive terrain error target required");
    return value;
  }
  private coarseTarget() { return Math.max(this.target, Math.min(96, this.target * 8)); }
  get errorTarget() { return this.selection; }
  setTarget(targetPx: number) {
    const target = this.validate(targetPx);
    if (target === this.target) return;
    this.target = target;
    this.reset();
  }
  reset() {
    this.selection = this.coarseTarget();
    this.coveredSince = this.missingSince = null;
    this.stage = "coverage";
    this.resets++;
  }
  update(now: number, meshes: number, coverage: WorldViewCoverage, screenErrorPx: number | null) {
    if (!Number.isFinite(now)) return;
    const current = coverage.sampledAtMs !== null && now - coverage.sampledAtMs <= 800;
    const covered = current && meshes > 0 && coverage.centerHit && coverage.tested >= 5 && coverage.hits === coverage.tested;
    if (!covered) {
      this.coveredSince = null;
      this.missingSince ??= now;
      // A single replacement frame is not a new destination. Persistent loss of
      // coverage re-establishes a coarse frontier even during ordinary playback.
      if (now - this.missingSince >= 500 && this.selection < this.coarseTarget()) this.reset();
      return;
    }
    this.missingSince = null;
    // A hit against a distant/coarse parent must not skip all intermediate levels.
    // Null means unknown, not zero; the normal diagnostic sample resolves it.
    const detailed = screenErrorPx !== null && Number.isFinite(screenErrorPx) && screenErrorPx <= this.selection * 1.5;
    if (!detailed) { this.coveredSince = null; return; }
    if (this.selection === this.target) { this.stage = "settled"; return; }
    this.coveredSince ??= now;
    if (now - this.coveredSince < 500) return;
    this.selection = Math.max(this.target, this.selection / 2);
    this.stage = "detail";
    this.coveredSince = null;
  }
  snapshot() {
    return { phase: this.stage, nominalTargetPx: this.target, selectionTargetPx: this.selection, resets: this.resets };
  }
}
