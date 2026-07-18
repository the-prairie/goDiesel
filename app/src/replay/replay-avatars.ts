export const REPLAY_AVATAR_STORAGE_KEY = "godiesel:replay-avatar";

export const REPLAY_AVATARS = [
  {
    id: "tempo-runner",
    label: "Tempo Runner",
    src: "/route-avatars/tempo-runner.lottie",
  },
  {
    id: "summit-runner",
    label: "Summit Runner",
    src: "/route-avatars/summit-runner.lottie",
  },
  {
    id: "road-rider",
    label: "Road Rider",
    src: "/route-avatars/road-rider.lottie",
  },
  {
    id: "gravel-rider",
    label: "Gravel Rider",
    src: "/route-avatars/gravel-rider.lottie",
  },
  {
    id: "hangout-runner",
    label: "Hangout Runner",
    src: "/avatar-lab/hangout-running.lottie",
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
