// The record of every recorded scene for the demo video: which clip, when it ran (UTC), and the mainnet
// transaction ids it shows, so the edit (captions) and the /demo chapters can name them. Kept in
// state/video/shots.json, not tracked. Pure helpers, tested in tests/video-shots.test.ts.

export const SCENES = ['front', 'how', 'swap', 'land', 'in', 'receipt'] as const;
export type Scene = (typeof SCENES)[number];

export interface Mark {
  /** Milliseconds from the start of the clip. */
  at: number;
  what: string;
}

export interface Shot {
  scene: Scene;
  engine: string;
  /** Clip file name inside the clip folder. */
  clip: string;
  startUtc: string;
  endUtc: string;
  /** Mainnet transaction ids on screen in this scene; each one is in docs/MEASURED.md. */
  txids: string[];
  /** Status page of the crossing shown, when there is one. */
  receipt?: string;
  /** Paid scenes: false when a transaction on screen was not seen by enough servers (a dropped broadcast). */
  ok?: boolean;
  /** Where the page came from when it is not the live site. */
  site: string;
  marks: Mark[];
}

export interface ShotsFile {
  shots: Shot[];
}

/** Adds a shot, replacing an earlier one of the same scene and engine (a scene recorded again replaces its clip). */
export function addShot(file: ShotsFile, shot: Shot): ShotsFile {
  return { shots: [...file.shots.filter((s) => !(s.scene === shot.scene && s.engine === shot.engine)), shot].sort((a, b) => SCENES.indexOf(a.scene) - SCENES.indexOf(b.scene)) };
}

/** Transaction ids of the shots that docs/MEASURED.md does not contain. */
export function missingTxids(file: ShotsFile, measured: string): string[] {
  return file.shots.flatMap((s) => s.txids).filter((t) => !measured.includes(t));
}

/** Every 64-hex transaction id in a set of explorer links, in order, without repeats. */
export function txidsFromLinks(hrefs: string[]): string[] {
  const seen = new Set<string>();
  for (const h of hrefs) {
    for (const m of h.matchAll(/(?:^|[^0-9a-fA-F])(?:0x)?([0-9a-fA-F]{64})(?![0-9a-fA-F])/g)) seen.add(m[1]!.toLowerCase());
  }
  return [...seen];
}

/** A small clock in the corner of the page, from the machine's real time: waits cut in the edit stay visible. */
export const CLOCK_OVERLAY = `(() => {
  const draw = () => {
    if (!document.body) return;
    let el = document.getElementById('__video_clock');
    if (!el) {
      el = document.createElement('div');
      el.id = '__video_clock';
      el.setAttribute('aria-hidden', 'true');
      el.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2147483647;pointer-events:none;font:600 14px/1.2 ui-monospace,monospace;padding:4px 8px;border-radius:6px;background:rgba(0,0,0,.72);color:#fff';
      document.body.appendChild(el);
    }
    el.textContent = new Date().toISOString().slice(11, 19) + ' UTC';
  };
  setInterval(draw, 250);
  document.addEventListener('DOMContentLoaded', draw);
})();`;
