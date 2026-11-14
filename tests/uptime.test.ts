import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// deploy/uptime.sh against a local HTTP server whose answer the test switches between 200 and 500.
let server: Server;
let status = 200;
let url = '';
let dir = '';

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'sampan-uptime-'));
  server = createServer((_req, res) => res.writeHead(status).end('x'));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const notify = path.join(dir, 'alert-hook');
  writeFileSync(notify, `#!/bin/sh\nprintf '%s|%s\\n' "$2" "$1" >> "${dir}/sent.log"\n`);
  chmodSync(notify, 0o755);
});
afterAll(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

const execFileAsync = promisify(execFile);

async function run(code: number, now: number): Promise<string[]> {
  status = code;
  const env: NodeJS.ProcessEnv = { ...process.env, UPTIME_URL: url, UPTIME_STATE: path.join(dir, 'state'), UPTIME_NOTIFY: path.join(dir, 'alert-hook'),
    UPTIME_NOW: String(now), UPTIME_LANG: 'en', UPTIME_CONTAINER: 'sampan-test-absent', UPTIME_TIMEOUT: '5' };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k];
  await execFileAsync('bash', ['deploy/uptime.sh'], { env });
  try {
    return readFileSync(path.join(dir, 'sent.log'), 'utf8').trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

describe('deploy/uptime.sh', () => {
  const t0 = Date.UTC(2026, 10, 15, 1) / 1000;
  it('stays quiet while healthy and after one failure', async () => {
    expect(await run(200, t0)).toEqual([]);
    expect(await run(500, t0 + 300)).toEqual([]);
  });
  it('sends one warning after the second failure in a row, and no repeat while down', async () => {
    const sent = await run(500, t0 + 600);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatch(/^warn\|Sampan is not healthy/);
    expect(await run(500, t0 + 900)).toHaveLength(1);
  });
  it('sends one info line on recovery', async () => {
    const sent = await run(200, t0 + 1200);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatch(/^info\|Sampan is healthy again/);
  });
});
