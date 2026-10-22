export type ReplayMarkerPreference =
  | { kind: "dot"; photo?: string }
  | { kind: "photo"; photo: string };

export const REPLAY_MARKER_KEY = "godiesel.replay-marker.v1";
export const DEFAULT_REPLAY_MARKER: ReplayMarkerPreference = { kind: "dot" };
const MAX_PHOTO_LENGTH = 200_000;
const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cached: ReplayMarkerPreference = DEFAULT_REPLAY_MARKER;

export function parseReplayMarker(raw: string | null): ReplayMarkerPreference {
  try {
    const value = JSON.parse(raw ?? "null");
    if (value?.version !== 1 || !["dot", "photo"].includes(value.kind))
      return DEFAULT_REPLAY_MARKER;
    const photo =
      typeof value.photo === "string" &&
      value.photo.length <= MAX_PHOTO_LENGTH &&
      /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value.photo)
        ? value.photo
        : undefined;
    return photo ? { kind: value.kind, photo } : DEFAULT_REPLAY_MARKER;
  } catch {
    return DEFAULT_REPLAY_MARKER;
  }
}

export function getReplayMarker(): ReplayMarkerPreference {
  if (typeof window === "undefined") return DEFAULT_REPLAY_MARKER;
  try {
    const raw = window.localStorage.getItem(REPLAY_MARKER_KEY);
    if (raw !== cachedRaw) {
      cachedRaw = raw;
      cached = parseReplayMarker(raw);
    }
  } catch {
    return cached;
  }
  return cached;
}

export function saveReplayMarker(preference: ReplayMarkerPreference) {
  const raw = JSON.stringify({ version: 1, ...preference });
  if (preference.photo && parseReplayMarker(raw).photo !== preference.photo)
    throw new Error("The cropped photo could not be saved. Try another photo.");
  try {
    window.localStorage.setItem(REPLAY_MARKER_KEY, raw);
  } catch {
    throw new Error(
      "Your browser could not save the marker. Free some site storage or allow local storage, then try again.",
    );
  }
  cachedRaw = raw;
  cached = preference;
  listeners.forEach((listener) => listener());
}

export function subscribeReplayMarker(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === REPLAY_MARKER_KEY || event.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}
