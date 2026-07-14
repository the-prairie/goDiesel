export const REPLAY_AVATAR_STORAGE_KEY = "godiesel:replay-avatar";

export const REPLAY_AVATARS = [
  { id: "run-rex", label: "Run Rex", src: "/route-avatars/run-rex.lottie" },
  { id: "nyan-cat", label: "Nyan Cat", src: "/route-avatars/nyan-cat.lottie" },
  { id: "mario", label: "Mario", src: "/route-avatars/mario.lottie" },
  { id: "walking", label: "Walking", src: "/route-avatars/walking.lottie" },
  {
    id: "hangout-running",
    label: "Hangout Running",
    src: "/route-avatars/hangout-running.lottie",
  },
] as const;

export type ReplayAvatarId = (typeof REPLAY_AVATARS)[number]["id"];

export function replayAvatarById(id: string | null | undefined) {
  return REPLAY_AVATARS.find((avatar) => avatar.id === id) ?? REPLAY_AVATARS[0];
}

export function storedReplayAvatar() {
  try {
    return replayAvatarById(window.localStorage.getItem(REPLAY_AVATAR_STORAGE_KEY));
  } catch {
    return REPLAY_AVATARS[0];
  }
}

export function persistReplayAvatar(id: ReplayAvatarId) {
  try {
    window.localStorage.setItem(REPLAY_AVATAR_STORAGE_KEY, id);
  } catch {
    // Replay remains usable when storage is unavailable.
  }
}
