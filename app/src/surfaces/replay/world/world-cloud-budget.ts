import type { WorldEnvironment } from "./world-model";

/** Independent cloud cost ceiling. Terrain resolution and chosen light never change. */
export const CLOUD_BUDGETS = [
  { name: "responsive", preset: "low", resolutionScale: 0.25, shadowSize: 64, steps: 64, shadowSteps: 12 },
  { name: "balanced", preset: "low", resolutionScale: 0.5, shadowSize: 128, steps: 128, shadowSteps: 20 },
  { name: "detailed", preset: "low", resolutionScale: 1, shadowSize: 256, steps: 200, shadowSteps: 25 },
  { name: "cinema", preset: "high", resolutionScale: 1, shadowSize: 512, steps: 500, shadowSteps: 50 },
] as const;
export type CloudBudgetReport = {
  tier: typeof CLOUD_BUDGETS[number]["name"] | "off";
  ceiling: typeof CLOUD_BUDGETS[number]["name"] | "off";
  resolutionScale: number;
  shadowSize: number;
  // A callback budget, not a claim that a GPU timer measured these frames.
  measurement: "visible-animation-frame-intervals";
};

/** Start affordably, earn detail with sustained headroom, retreat quickly on stalls. */
export class WorldCloudBudget {
  private enabled = false;
  private ceiling = 0;
  private level = 0;
  private fastMs = 0;
  private slowMs = 0;
  private cooldownMs = 0;
  configure(quality: WorldEnvironment["quality"], clouds: number) {
    const enabled = quality !== "light" && clouds > 0;
    if (enabled !== this.enabled) {
      this.level = 0; this.fastMs = this.slowMs = this.cooldownMs = 0;
    }
    this.enabled = enabled;
    this.ceiling = quality === "cinema" ? 3 : 2;
    this.level = Math.min(this.level, this.ceiling);
  }
  observe(elapsedMs: number) {
    if (!this.enabled || !Number.isFinite(elapsedMs) || elapsedMs <= 0) return;
    this.cooldownMs = Math.max(0, this.cooldownMs - elapsedMs);
    this.fastMs = elapsedMs <= 18 ? this.fastMs + elapsedMs : 0;
    this.slowMs = elapsedMs > 40 ? this.slowMs + elapsedMs : Math.max(0, this.slowMs - elapsedMs);
    if ((elapsedMs > 100 || this.slowMs >= 400) && this.level > 0) {
      this.level--; this.fastMs = this.slowMs = 0; this.cooldownMs = 3000;
    } else if (this.fastMs >= 2000 && this.cooldownMs === 0 && this.level < this.ceiling) {
      this.level++; this.fastMs = this.slowMs = 0;
    }
  }
  get settings() { return CLOUD_BUDGETS[this.level]; }
  snapshot(): CloudBudgetReport {
    return {
      tier: this.enabled ? this.settings.name : "off",
      ceiling: this.enabled ? CLOUD_BUDGETS[this.ceiling].name : "off",
      resolutionScale: this.enabled ? this.settings.resolutionScale : 0,
      shadowSize: this.enabled ? this.settings.shadowSize : 0,
      measurement: "visible-animation-frame-intervals",
    };
  }
}
