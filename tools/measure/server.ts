// The built server (dist/) on this host against the real network, for the measuring scripts. Each script passes
// the config patch that opens the flow it measures; rate limits are lifted because every request of a run comes
// from one local address.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const RATE_PATCH = { quotesPerMinute: 1000, crossingsPerHour: 1000 };

export function startServer(o: { port: number; dataDir: string; patch: Record<string, unknown>; env?: Record<string, string> }): ChildProcess {
  mkdirSync(o.dataDir, { recursive: true });
  const patch = { ...o.patch, rate: RATE_PATCH };
  return spawn('node', ['dist/server/main.js'], {
    env: { ...process.env, ...o.env, PORT: String(o.port), HOST: '127.0.0.1', SAMPAN_DATA: o.dataDir, SAMPAN_CONFIG_PATCH: JSON.stringify(patch) },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

export async function waitHealthy(base: string): Promise<void> {
  for (let i = 0; i < 60; i++) {
    const ok = await fetch(`${base}/healthz`).then((r) => r.ok, () => false);
    if (ok) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('server did not start');
}

/** The page's "Copy link" lands in window.__copied. A string, so the bundler's helpers never reach the page. */
export const CLIPBOARD_SPY =
  "Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { window.__copied = t; } } });";
