export interface PhotoCrop {
  zoom: number;
  x: number;
  y: number;
}
export interface MarkerPhotoSource {
  url: string;
  width: number;
  height: number;
}
export type MarkerPhotoState =
  | { phase: "idle"; error?: string }
  | { phase: "loading"; requestId: number }
  | {
      phase: "cropping";
      requestId: number;
      source: MarkerPhotoSource;
      crop: PhotoCrop;
      error?: string;
    };
export type MarkerPhotoEvent =
  | { type: "uploadStarted"; requestId: number }
  | { type: "photoLoaded"; requestId: number; source: MarkerPhotoSource }
  | { type: "uploadFailed"; requestId: number; message: string }
  | { type: "cropAdjusted"; crop: PhotoCrop }
  | { type: "editingCancelled" }
  | { type: "photoSaved" }
  | { type: "saveFailed"; message: string };

export function reduceMarkerPhoto(
  state: MarkerPhotoState,
  event: MarkerPhotoEvent,
): MarkerPhotoState {
  switch (event.type) {
    case "uploadStarted":
      return { phase: "loading", requestId: event.requestId };
    case "photoLoaded":
      return state.phase === "loading" && state.requestId === event.requestId
        ? {
            phase: "cropping",
            requestId: event.requestId,
            source: event.source,
            crop: { zoom: 1, x: 0.5, y: 0.5 },
          }
        : state;
    case "uploadFailed":
      return state.phase === "loading" && state.requestId === event.requestId
        ? { phase: "idle", error: event.message }
        : state;
    case "cropAdjusted":
      return state.phase === "cropping"
        ? { ...state, crop: boundPhotoCrop(event.crop), error: undefined }
        : state;
    case "photoSaved":
    case "editingCancelled":
      return { phase: "idle" };
    case "saveFailed":
      return state.phase === "loading"
        ? state
        : { ...state, error: event.message };
  }
}

export function boundPhotoCrop(crop: PhotoCrop): PhotoCrop {
  return {
    zoom: Math.max(1, Math.min(3, crop.zoom)),
    x: Math.max(0, Math.min(1, crop.x)),
    y: Math.max(0, Math.min(1, crop.y)),
  };
}

export function photoCropRectangle(
  source: Pick<MarkerPhotoSource, "width" | "height">,
  crop: PhotoCrop,
) {
  const bounded = boundPhotoCrop(crop);
  const size = Math.min(source.width, source.height) / bounded.zoom;
  return {
    x: (source.width - size) * bounded.x,
    y: (source.height - size) * bounded.y,
    size,
  };
}

export function dragPhotoCrop(
  source: MarkerPhotoSource,
  crop: PhotoCrop,
  dx: number,
  dy: number,
  viewportSize: number,
) {
  const { size } = photoCropRectangle(source, crop);
  return boundPhotoCrop({
    ...crop,
    x:
      source.width === size
        ? crop.x
        : crop.x - (dx * size) / viewportSize / (source.width - size),
    y:
      source.height === size
        ? crop.y
        : crop.y - (dy * size) / viewportSize / (source.height - size),
  });
}
