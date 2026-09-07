import { describe, expect, it } from "vitest";
import { WorldCloudBudget } from "./world-cloud-budget";
describe("independent adaptive cloud budget", () => {
  it("starts with visible inexpensive clouds instead of blocking input with the maximum preset", () => {
    const budget = new WorldCloudBudget(); budget.configure("cinema", .55);
    expect(budget.snapshot()).toMatchObject({tier:"responsive",ceiling:"cinema",resolutionScale:.25});
    for (let i=0;i<100;i++) budget.observe(400);
    expect(budget.snapshot().tier).toBe("responsive");
  });
  it("earns the entire Cinema ceiling on a device with sustained rendering headroom", () => {
    const budget = new WorldCloudBudget(); budget.configure("cinema", .55);
    for (let i=0;i<800;i++) budget.observe(8.33);
    expect(budget.snapshot().tier).toBe("cinema");
    budget.observe(300); expect(budget.snapshot().tier).toBe("detailed");
    for (let i=0;i<241;i++) budget.observe(8.33);
    expect(budget.snapshot().tier).toBe("detailed"); // no oscillation after a stall
    for (let i=0;i<130;i++) budget.observe(8.33);
    expect(budget.snapshot().tier).toBe("cinema");
  });
  it("respects Balanced's ceiling, disables all cloud work in Light/clear sky, and restarts affordably", () => {
    const budget = new WorldCloudBudget(); budget.configure("balanced", .55);
    for (let i=0;i<2000;i++) budget.observe(8);
    expect(budget.snapshot().tier).toBe("detailed");
    budget.configure("cinema", 0); expect(budget.snapshot().tier).toBe("off");
    budget.configure("cinema", .55); expect(budget.snapshot().tier).toBe("responsive");
    budget.configure("light", .55); expect(budget.snapshot().tier).toBe("off");
  });
  it("ignores invalid samples but includes very slow visible frames", () => {
    const budget = new WorldCloudBudget(); budget.configure("cinema", .55);
    for (let i=0;i<800;i++) budget.observe(8.33);
    for (const ms of [NaN, Infinity, -4, 0]) budget.observe(ms);
    expect(budget.snapshot().tier).toBe("cinema");
    budget.observe(2500); expect(budget.snapshot().tier).toBe("detailed");
  });
});
