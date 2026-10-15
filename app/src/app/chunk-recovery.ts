const RECOVERY_KEY = "godiesel:chunk-recovery";

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|Loading chunk [\w-]+ failed/i.test(message);
}

/** Refresh at most once per loaded shell. Blocked storage opts into manual retry. */
export function recoverChunkLoad(error: unknown): boolean {
  if (!isChunkLoadError(error) || !navigator.onLine) return false;
  try {
    const shell = import.meta.url;
    if (sessionStorage.getItem(RECOVERY_KEY) === shell) return false;
    sessionStorage.setItem(RECOVERY_KEY, shell);
  } catch {
    return false;
  }
  // Preserve the complete URL, including Finder query and route return context.
  window.location.reload();
  return true;
}

export function installChunkRecovery() {
  window.addEventListener("vite:preloadError", (event) => {
    recoverChunkLoad((event as Event & { payload: unknown }).payload);
  });
}
