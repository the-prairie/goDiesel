/**
 * A renderer can ask the owning transport to hold the current moment while its
 * landscape is missing. It never rewrites distance, camera choice or play intent.
 * Hysteresis prevents a single tile replacement frame from interrupting a flight.
 */
export class WorldContinuity {
  private missingAt: number | null = null;
  private coveredAt: number | null = null;
  holding = false;
  update(now: number, enabled: boolean, covered: boolean) {
    if (!enabled) {
      this.missingAt = this.coveredAt = null;
      this.holding = false;
    } else if (!covered) {
      this.coveredAt = null;
      this.missingAt ??= now;
      if (now - this.missingAt >= 200) this.holding = true;
    } else {
      this.missingAt = null;
      this.coveredAt ??= now;
      if (now - this.coveredAt >= 250) this.holding = false;
    }
    return this.holding;
  }
}
