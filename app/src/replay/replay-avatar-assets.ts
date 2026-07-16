import { REPLAY_AVATARS } from "@/replay/replay-avatars";

const avatarData = new Map<string, Promise<ArrayBuffer>>();

export function loadReplayAvatarData(src: string) {
  const existing = avatarData.get(src);
  if (existing) return existing;

  const request = fetch(src)
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Replay avatar failed to load: ${response.status}`);
      }
      return response.arrayBuffer();
    })
    .catch((error) => {
      avatarData.delete(src);
      throw error;
    });
  avatarData.set(src, request);
  return request;
}

export function preloadReplayAvatars() {
  return Promise.all(
    REPLAY_AVATARS.map((avatar) => loadReplayAvatarData(avatar.src)),
  );
}
