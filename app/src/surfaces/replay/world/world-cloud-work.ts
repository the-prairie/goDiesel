import { CloudsEffect } from "@takram/three-clouds";
import type { WebGLRenderer, WebGLRenderTarget } from "three";

/**
 * skipRendering is a shader define in three-clouds 0.7.6, not a work gate.
 * Its update still raymarches the shadow/volume passes. Explicitly park those
 * passes while clouds are off. No global patch, fake frame, or changed preset.
 */
export class WorldCloudsEffect extends CloudsEffect {
  workEnabled = false;
  submittedFrames = 0;
  override update(renderer: WebGLRenderer, input: WebGLRenderTarget, delta = 0) {
    if (!this.workEnabled) return;
    super.update(renderer, input, delta);
    this.submittedFrames++;
  }
}
