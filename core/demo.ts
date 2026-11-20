// The /demo page (ADR 0082, ADR 0084): the demo videos served from the media host, the chapters and the subtitle
// tracks. Pure helpers shared by tools/video/demo-files.ts (which writes docs/demo/chapters.json, the full walkthrough
// into media/ and its tracks into web/public/demo/), the tests and the page.
// A chapter is a scene of the cut that shows at least one mainnet transaction kept by the network (an ok row of
// docs/MEASURED.md); scenes without one (the opening, the end card) have no chapter but keep their subtitles.

export interface DemoConfig {
  /** The owner's own upload of the same video, shown as a second link when set. Only the owner fills it. */
  youtubeUrl: string;
  /** The one minute cut (English subtitles burned in), served from the media host: https://<media.host>/media/….mp4. */
  video: string;
  /** The full walkthrough the chapters belong to (no subtitles burned in), served from the media host the same way. */
  videoLong: string;
  /** Subtitle tracks of the full walkthrough on this site: <tracks>.<language>.vtt (a track needs the page's own origin). */
  tracks: string;
  /** Path of the still image shown before the video plays. */
  poster: string;
  /** How many transaction ids a chapter lists before "and N more" links to the proof table. */
  txidsShown: number;
}

/**
 * Video files are not served by the site's own host name (its CDN terms do not cover video): a second host name that
 * points at the same server without the CDN serves /media/* and nothing else (ADR 0084).
 */
export interface MediaConfig {
  /** Host name the server answers /media/* for; every other host gets 404 there. */
  host: string;
  /** Cache-Control of a media file. */
  cacheControl: string;
}

export function validateMedia(m: MediaConfig | undefined, siteUrl: string): string[] {
  const errors: string[] = [];
  const site = /^https?:\/\/([^/:]+)/.exec(siteUrl)?.[1]?.toLowerCase();
  if (!(typeof m?.host === 'string' && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(m.host) && m.host !== site)) {
    errors.push('media.host: a lower-case host name other than the site\'s own');
  }
  if (!(typeof m?.cacheControl === 'string' && /^[a-z0-9=, -]{1,100}$/.test(m.cacheControl))) errors.push('media.cacheControl: a Cache-Control value');
  return errors;
}

/** Repository path of a media URL (https://<media.host>/media/demo/x.mp4 → media/demo/x.mp4), or null for any other URL. */
export function mediaFile(url: string, host: string): string | null {
  const m = /^https:\/\/([^/]+)\/(media\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.[a-z0-9]+)$/.exec(url);
  return m && m[1] === host ? m[2]! : null;
}

export function validateDemo(d: DemoConfig | undefined, mediaHost: string): string[] {
  const errors: string[] = [];
  const path = (v: unknown): boolean => typeof v === 'string' && /^\/[A-Za-z0-9/_.-]+$/.test(v);
  if (!(d?.youtubeUrl === '' || (typeof d?.youtubeUrl === 'string' && /^https:\/\/(www\.)?(youtube\.com|youtu\.be)\//.test(d.youtubeUrl)))) {
    errors.push('demo.youtubeUrl: empty or an https YouTube link');
  }
  for (const k of ['video', 'videoLong'] as const) {
    if (!String(mediaFile(String(d?.[k]), mediaHost)).endsWith('.mp4')) errors.push(`demo.${k}: https://${mediaHost}/media/….mp4`);
  }
  if (!path(d?.tracks) || /\.[a-z0-9]+$/.test(String(d?.tracks))) errors.push('demo.tracks: a path on this site without an extension');
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
  /** Words the chapter titles and subtitles fill in, read from the measured runs the video shows (lang/ names no asset). */
  vars: Record<string, string>;
  /** False: the web cut carries no spoken subtitles in its picture, so the page's tracks never stack on burned ones. */
  burnedSubtitles: boolean;
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
 * receipt of a shot recorded on `site`. Ids an earlier chapter already lists are not listed again, and a scene left
 * with no new id (the opening, the end card, the phone view of the proof table) is not a chapter.
 */
export function buildChapters(placed: Array<DemoScene & { files: string[] }>, shots: ChapterShot[], runs: ChapterRun[], site: string): DemoChapter[] {
  const kept = new Map<string, string>();
  for (const r of runs) if (r.ok) for (const id of r.ids) kept.set(bare(id), id);
  const chapters: DemoChapter[] = [];
  const listed = new Set<string>();
  for (const p of placed) {
    const used = shots.filter((s) => p.files.includes(s.clip));
    const txids = [...new Set(used.flatMap((s) => s.txids.map((t) => kept.get(bare(t)))).filter((t): t is string => Boolean(t) && !listed.has(bare(t!))))];
    if (txids.length === 0) continue;
    for (const t of txids) listed.add(bare(t));
    const receipt = used.find((s) => s.receipt && s.site === site)?.receipt;
    chapters.push({ id: p.id, start: p.start, titleKey: `demo.ch.${p.id}`, txids, ...(receipt ? { receipt } : {}) });
  }
  return chapters;
}

/** The stablecoin of a Runs amount such as `1.6 AVAX.USDC to PUSD`: the symbol after the chain, or null. */
export function assetOfAmount(amount: string): string | null {
  return /\b[A-Z]+\.([A-Z]+)\b/.exec(amount)?.[1] ?? null;
}

/** Fills `{name}` from the file's words; a name it does not hold stays visible, so a gap is never silent. */
export const fillVars = (text: string, vars: Record<string, string>): string => text.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);

/** Problems with a chapters file against the ok ids of MEASURED: none means the /demo page may show it. */
export function checkChapters(file: DemoFile, runs: ChapterRun[]): string[] {
  const ok = new Set(runs.filter((r) => r.ok).flatMap((r) => r.ids.map(bare)));
  const errors: string[] = [];
  if (file.burnedSubtitles !== false) errors.push('the web video has subtitles burned in: the page tracks would stack on them');
  let last = -1;
  const seen = new Set<string>();
  for (const c of file.chapters) {
    for (const t of c.txids) {
      if (seen.has(bare(t))) errors.push(`${c.id}: ${t} is already listed by an earlier chapter`);
      seen.add(bare(t));
    }
    if (!(c.start > last)) errors.push(`${c.id}: start ${c.start} does not come after ${last}`);
    last = c.start;
    if (c.start > file.seconds) errors.push(`${c.id}: starts after the end of the video`);
    if (c.txids.length === 0) errors.push(`${c.id}: no transaction id`);
    for (const t of c.txids) if (!ok.has(bare(t))) errors.push(`${c.id}: ${t} is not in an ok row of MEASURED`);
    if (c.receipt !== undefined && !/^\/c\/[0-9a-f]{32}$/.test(c.receipt)) errors.push(`${c.id}: receipt ${c.receipt} is not a status page`);
  }
  if (file.chapters.length < 4) errors.push('fewer than 4 chapters');
  for (const [k, v] of Object.entries(file.vars)) if (!/^[A-Za-z0-9 .-]{1,40}$/.test(v)) errors.push(`vars.${k}: ${v} is not a plain word`);
  return errors;
}

/** Site path of the full walkthrough's subtitle track in one page language. */
export const trackPath = (tracks: string, code: string): string => `${tracks}.${code}.vtt`;
