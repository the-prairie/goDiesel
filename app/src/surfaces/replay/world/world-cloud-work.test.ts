import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudsEffect } from "@takram/three-clouds";
import { WorldCloudsEffect } from "./world-cloud-work";
import type { WebGLRenderer, WebGLRenderTarget } from "three";

afterEach(() => vi.restoreAllMocks());
describe("optional cloud work", () => {
  it("never enters the real volume or shadow update while the sky is clear", () => {
    const update = vi.spyOn(CloudsEffect.prototype, "update");
    const clouds = new WorldCloudsEffect();
    for (let i = 0; i < 240; i++) clouds.update({} as WebGLRenderer, {} as WebGLRenderTarget, 1 / 120);
    expect(update).not.toHaveBeenCalled();
    expect(clouds.submittedFrames).toBe(0);
    clouds.dispose();
  });
  it("resumes the original implementation only when enabled and parks again", () => {
    const update = vi.spyOn(CloudsEffect.prototype, "update").mockImplementation(() => {});
    const clouds = new WorldCloudsEffect();
    clouds.workEnabled = true;
    clouds.update({} as WebGLRenderer, {} as WebGLRenderTarget, 0.016);
    expect(update).toHaveBeenCalledOnce();
    clouds.workEnabled = false;
    clouds.update({} as WebGLRenderer, {} as WebGLRenderTarget, 0.016);
    expect(update).toHaveBeenCalledOnce();
    expect(clouds.submittedFrames).toBe(1);
    clouds.dispose();
  });
});
