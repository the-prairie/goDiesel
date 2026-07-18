export const GOOGLE_3D_TILES_RENDER_OPTIONS = {
  maximumScreenSpaceError: 16,
  dynamicScreenSpaceError: true,
  skipLevelOfDetail: false,
} as const;

export const CESIUM_GROUND_ROUTE_OPTIONS = {
  clampToGround: true,
  zIndex: 10,
} as const;
