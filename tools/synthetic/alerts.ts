// Alert rule of the hourly synthetic monitor (deploy/synthetic.sh). Pure: state in, state and alerts out.
// Per probe: two failures in a row = a "warn"; the first success after that = an "info"; each probe's alert at most
// once per UTC day, and the probes that change in one run share one message.
// A probe that did not run in this pass (render runs twice a day) keeps its state.

export interface ProbeResult {
  probe: string;
  ok: boolean;
  ms: number;
  detail: string;
}

export interface ProbeState {
  fails: number;
  down: boolean;
}

export interface RunRecord {
  at: string;
  ok: boolean;
  failed: string[];
}

export interface SyntheticState {
  probes: Record<string, ProbeState>;
  /** UTC day and the alert keys already sent that day. */
  sent: { day: string; keys: string[] };
  /** Newest last, at most KEEP_RUNS. */
  runs: RunRecord[];
}

export interface Alert {
  level: 'warn' | 'info';
  key: string;
  text: string;
}

export const KEEP_RUNS = 48;
export const FAILS_BEFORE_ALERT = 2;

export const emptyState = (): SyntheticState => ({ probes: {}, sent: { day: '', keys: [] }, runs: [] });

export function readState(raw: string | undefined): SyntheticState {
  if (!raw) return emptyState();
  try {
    const s = JSON.parse(raw) as Partial<SyntheticState>;
    return {
      probes: s.probes && typeof s.probes === 'object' ? s.probes : {},
      sent: s.sent && typeof s.sent.day === 'string' && Array.isArray(s.sent.keys) ? s.sent : { day: '', keys: [] },
      runs: Array.isArray(s.runs) ? s.runs.slice(-KEEP_RUNS) : [],
    };
  } catch {
    return emptyState();
  }
}

/** Looks up a text by key; {probe} and {detail} are filled in. Unknown key = the key itself. */
export type Texts = (key: string) => string | undefined;

const fill = (t: string, vars: Record<string, string>): string => t.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);

export function step(prev: SyntheticState, results: ProbeResult[], now: Date, texts: Texts): { state: SyntheticState; alerts: Alert[] } {
  const day = now.toISOString().slice(0, 10);
  const sentKeys = prev.sent.day === day ? [...prev.sent.keys] : [];
  const probes: Record<string, ProbeState> = { ...prev.probes };
  const wentDown: ProbeResult[] = [];
  const cameBack: ProbeResult[] = [];

  for (const r of results) {
    const p = probes[r.probe] ?? { fails: 0, down: false };
    if (r.ok) {
      if (p.down) cameBack.push(r);
      probes[r.probe] = { fails: 0, down: false };
      continue;
    }
    const fails = p.fails + 1;
    const down = p.down || fails >= FAILS_BEFORE_ALERT;
    if (down && !p.down) wentDown.push(r);
    probes[r.probe] = { fails, down };
  }

  // One message per run and level: the first probe's text (probes run in order of what a visitor meets first),
  // the others named after it. A probe's alert counts as sent for the day even when it rode in another's message.
  const alerts: Alert[] = [];
  const group = (level: Alert['level'], prefix: string, list: ProbeResult[], textKey: (r: ProbeResult) => string) => {
    const fresh = list.filter((r) => !sentKeys.includes(`${prefix}:${r.probe}`));
    if (!fresh.length) return;
    const [first, ...rest] = fresh as [ProbeResult, ...ProbeResult[]];
    const names = fresh.map((r) => r.probe).join(', ');
    let text = fill(texts(textKey(first)) ?? textKey(first), { probe: level === 'info' ? names : first.probe, detail: first.detail });
    if (level === 'warn' && rest.length) text += ` ${fill(texts('alerts.synthetic.also') ?? 'Also failing: {probes}.', { probes: rest.map((r) => r.probe).join(', ') })}`;
    for (const r of fresh) sentKeys.push(`${prefix}:${r.probe}`);
    alerts.push({ level, key: `${prefix}:${names}`, text });
  };
  group('warn', 'down', wentDown, (r) => `alerts.synthetic.${r.probe}`);
  group('info', 'recovered', cameBack, () => 'alerts.synthetic.recovered');

  const failed = results.filter((r) => !r.ok).map((r) => r.probe);
  const runs = [...prev.runs, { at: now.toISOString(), ok: failed.length === 0, failed }].slice(-KEEP_RUNS);
  return { state: { probes, sent: { day, keys: sentKeys }, runs }, alerts };
}
