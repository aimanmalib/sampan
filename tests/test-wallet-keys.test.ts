import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureSecrets, missingSecrets, parseEnv, SECRET_KEYS } from '../tools/test-wallet/keys.js';

const dirs: string[] = [];
const tmpFile = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'sampan-keys-'));
  dirs.push(d);
  return path.join(d, '.env');
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('test wallet env file', () => {
  it('parses quoted and bare values and skips comments', () => {
    const env = parseEnv('# c\nA="x y"\nB=z\n\nbad line\n');
    expect(env.get('A')).toBe('x y');
    expect(env.get('B')).toBe('z');
    expect(env.size).toBe(2);
  });

  it('creates all three secrets with mode 0600 and keeps unrelated lines', () => {
    const f = tmpFile();
    writeFileSync(f, 'OTHER=1', { mode: 0o644 });
    const env = ensureSecrets(f);
    expect(statSync(f).mode & 0o777).toBe(0o600);
    expect(env.get('OTHER')).toBe('1');
    for (const k of Object.values(SECRET_KEYS)) expect(env.get(k)).toBeTruthy();
  });

  it('never replaces an existing secret', () => {
    const f = tmpFile();
    const first = ensureSecrets(f);
    const text = readFileSync(f, 'utf8');
    const again = ensureSecrets(f);
    expect(readFileSync(f, 'utf8')).toBe(text);
    expect(again.get(SECRET_KEYS.bchMainnet)).toBe(first.get(SECRET_KEYS.bchMainnet));
  });

  it('refuses a malformed existing value instead of overwriting it', () => {
    const env = new Map([[SECRET_KEYS.evm, '0x12']]);
    expect(() => missingSecrets(env)).toThrow(/fix it by hand/);
  });
});
