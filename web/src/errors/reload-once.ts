// A tab left open across a deploy asks for script files that no longer exist. The fix is a fresh page, once:
// a session flag stops a reload loop when the files are truly missing, and then the error card shows instead.
const FLAG = 'sampan.reloadedForChunk';

/** True for the browser messages of a script module that failed to load (Chromium, WebKit, Firefox, Vite preload). */
export function isChunkError(e: unknown): boolean {
  const message = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported|Unable to preload CSS|ChunkLoadError/i.test(
    message,
  );
}

export interface ReloadDeps {
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  reload: () => void;
}

/** Reloads the page if it has not done so for this reason in this tab session. Returns true when it reloads. */
export function reloadOnce(deps: ReloadDeps): boolean {
  try {
    if (!deps.storage || deps.storage.getItem(FLAG) !== null) return false;
    deps.storage.setItem(FLAG, '1');
  } catch {
    return false; // storage blocked: never risk a loop
  }
  deps.reload();
  return true;
}

export const browserReload = (): ReloadDeps => ({
  storage: typeof sessionStorage === 'undefined' ? null : sessionStorage,
  reload: () => location.reload(),
});
