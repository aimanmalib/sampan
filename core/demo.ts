// The /demo page (ADR 0082): the demo video served from this site, its chapters and its subtitle tracks. Pure helpers
// shared by tools/video/demo-files.ts (which writes docs/demo/chapters.json and web/public/demo/), the tests and the page.
// A chapter is a scene of the cut that shows at least one mainnet transaction kept by the network (an ok row of
// docs/MEASURED.md); scenes without one (the opening, the end card) have no chapter but keep their subtitles.

export interface DemoConfig {
  /** The owner's own upload of the same video, shown as a second link when set. Only the owner fills it. */
  youtubeUrl: string;
  /** Path of the video file on this site. */
  video: string;
  /** Path of the still image shown before the video plays. */
  poster: string;
  /** How many transaction ids a chapter lists before "and N more" links to the proof table. */
  txidsShown: number;
}

export function validateDemo(d: DemoConfig | undefined): string[] {
  const errors: string[] = [];
  const path = (v: unknown): boolean => typeof v === 'string' && /^\/[A-Za-z0-9/_.-]+$/.test(v);
  if (!(d?.youtubeUrl === '' || (typeof d?.youtubeUrl === 'string' && /^https:\/\/(www\.)?(youtube\.com|youtu\.be)\//.test(d.youtubeUrl)))) {
    errors.push('demo.youtubeUrl: empty or an https YouTube link');
  }
  if (!path(d?.video) || !String(d?.video).endsWith('.mp4')) errors.push('demo.video: a path on this site ending in .mp4');
  if (!path(d?.poster)) errors.push('demo.poster: a path on this site');
  if (!(Number.isInteger(d?.txidsShown) && (d?.txidsShown as number) >= 1 && (d?.txidsShown as number) <= 50)) {
    errors.push('demo.txidsShown: an integer from 1 to 50');
  }
  return errors;
}

/** One scene of the cut as the edit placed it (seconds from the start of the video). */
export interface DemoScene {
  id: string;
  start: number;
  duration: number;
  /** Where the narration of the scene starts and how long it speaks: subtitles in other languages share this span. */
  voiceAt: number;
  voiceSeconds: number;
}

export interface DemoChapter {
  id: string;
  start: number;
  /** Text key of the chapter title in lang/<code>.json. */
  titleKey: string;
  /** Transaction ids as docs/MEASURED.md writes them (EVM ids keep their 0x). */
  txids: string[];
  /** Status page of the crossing shown, when it is on the live site. */
  receipt?: string;
}

export interface DemoFile {
  seconds: number;
  scenes: DemoScene[];
  chapters: DemoChapter[];
}

/** What a recorded shot tells the chapters: its clip file, the ids on screen, its status page and where it ran. */
export interface ChapterShot {
  clip: string;
  txids: string[];
  receipt?: string;
  site: string;
}

/** A Runs row reduced to what a chapter needs: its result and its ids as written. */
export interface ChapterRun {
  ok: boolean;
  ids: string[];
}

const bare = (id: string): string => id.toLowerCase().replace(/^0x/, '');

/**
 * Chapters of the cut: for every placed scene, the shots its windows come from; the ids on screen that an ok run
 * of MEASURED holds (a dropped broadcast is listed only in a fail row, so it never becomes a chapter id); the
 * receipt of a shot recorded on `site`. Scenes left with no id are not chapters.
 */
export function buildChapters(placed: Array<DemoScene & { files: string[] }>, shots: ChapterShot[], runs: ChapterRun[], site: string): DemoChapter[] {
  const kept = new Map<string, string>();
  for (const r of runs) if (r.ok) for (const id of r.ids) kept.set(bare(id), id);
  const chapters: DemoChapter[] = [];
  for (const p of placed) {
    const used = shots.filter((s) => p.files.includes(s.clip));
    const txids = [...new Set(used.flatMap((s) => s.txids.map((t) => kept.get(bare(t)))).filter((t): t is string => Boolean(t)))];
    if (txids.length === 0) continue;
    const receipt = used.find((s) => s.receipt && s.site === site)?.receipt;
    chapters.push({ id: p.id, start: p.start, titleKey: `demo.ch.${p.id}`, txids, ...(receipt ? { receipt } : {}) });
  }
  return chapters;
}

/** Problems with a chapters file against the ok ids of MEASURED: none means the /demo page may show it. */
export function checkChapters(file: DemoFile, runs: ChapterRun[]): string[] {
  const ok = new Set(runs.filter((r) => r.ok).flatMap((r) => r.ids.map(bare)));
  const errors: string[] = [];
  let last = -1;
  for (const c of file.chapters) {
    if (!(c.start > last)) errors.push(`${c.id}: start ${c.start} does not come after ${last}`);
    last = c.start;
    if (c.start > file.seconds) errors.push(`${c.id}: starts after the end of the video`);
    if (c.txids.length === 0) errors.push(`${c.id}: no transaction id`);
    for (const t of c.txids) if (!ok.has(bare(t))) errors.push(`${c.id}: ${t} is not in an ok row of MEASURED`);
    if (c.receipt !== undefined && !/^\/c\/[0-9a-f]{32}$/.test(c.receipt)) errors.push(`${c.id}: receipt ${c.receipt} is not a status page`);
  }
  if (file.chapters.length < 4) errors.push('fewer than 4 chapters');
  return errors;
}
