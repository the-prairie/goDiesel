export interface AtlasViewportInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface AtlasCameraFrame {
  rangeM: number;
  horizontalOffsetRatio: number;
  verticalOffsetRatio: number;
  insets: AtlasViewportInsets;
}

const MINIMUM_REGIONAL_RANGE_M = 800;
const FRAME_BREATHING_ROOM = 1.18;

export function atlasViewportInsets(width: number, height: number) {
  if (width < 768) {
    return {
      top: Math.min(170, height * 0.24),
      right: 20,
      bottom: Math.min(280, height * 0.36),
      left: 20,
    } satisfies AtlasViewportInsets;
  }

  return {
    top: 96,
    right: Math.min(420, width * 0.3),
    bottom: Math.min(240, height * 0.28),
    left: Math.min(260, width * 0.2),
  } satisfies AtlasViewportInsets;
}

export function atlasCameraFrame(
  sphereRadiusM: number,
  viewport: { width: number; height: number },
  verticalFovRadians: number,
  insets = atlasViewportInsets(viewport.width, viewport.height),
): AtlasCameraFrame {
  const width = Math.max(1, viewport.width);
  const height = Math.max(1, viewport.height);
  const usableWidth = Math.max(width * 0.25, width - insets.left - insets.right);
  const usableHeight = Math.max(height * 0.25, height - insets.top - insets.bottom);
  const verticalTangent = Math.tan(verticalFovRadians / 2);
  const horizontalTangent = verticalTangent * (width / height);
  const horizontalFitAngle = Math.atan((usableWidth / width) * horizontalTangent);
  const verticalFitAngle = Math.atan((usableHeight / height) * verticalTangent);
  const fitAngle = Math.max(0.05, Math.min(horizontalFitAngle, verticalFitAngle));
  const radius = Math.max(500, sphereRadiusM);

  return {
    rangeM: Math.max(
      MINIMUM_REGIONAL_RANGE_M,
      (radius * FRAME_BREATHING_ROOM) / Math.sin(fitAngle),
    ),
    horizontalOffsetRatio: (insets.left - insets.right) / width,
    verticalOffsetRatio: (insets.top - insets.bottom) / height,
    insets,
  };
}

export function atlasRegionTransitionDurationSeconds(reducedMotion: boolean) {
  return reducedMotion ? 0.12 : 1.15;
}
