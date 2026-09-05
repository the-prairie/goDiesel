/** Dedicated walk configuration. Never import the deterministic E2E config. */
export const walkDefaults = Object.freeze({
  profile: 'controlled',
  mission: 'memory',
  driver: 'guided',
  viewport: 'desktop',
  session: 'fresh',
  actionBudget: 80,
  requestBudget: 2500,
  timeBudgetSeconds: 240,
  actionTimeoutMs: 15000,
});
export const viewports = Object.freeze({
  desktop: { width: 1440, height: 900 },
  phone: { width: 390, height: 844 },
  landscape: { width: 844, height: 390 },
});
