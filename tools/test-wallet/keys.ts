// Create the test wallet secrets once and show their public addresses.
//   npm run test-wallet:keys            print the addresses (creates any missing secret first)
//   SAMPAN_ENV_FILE=<path>              env file to use (default .env in the repository root)
// Secrets are only ever written to the env file (mode 0600, replaced atomically) and never printed.
// An existing value is never replaced: losing a funded phrase would lose the test funds.
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { BCH_RECEIVE_PATH, deriveBchKey, evmAddress, isValidBip39Phrase, isValidEvmKey, newBip39Phrase } from '../../core/keys.js';

export const SECRET_KEYS = {
  bchMainnet: 'SAMPAN_TEST_BCH_PHRASE',
  bchChipnet: 'SAMPAN_TEST_CHIPNET_PHRASE',
  evm: 'SAMPAN_TEST_EVM_KEY',
} as const;

export function parseEnv(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    out.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, '$2'));
  }
  return out;
}

/** Returns the lines to append so that every secret exists and is well formed; throws on a malformed existing value. */
export function missingSecrets(env: Map<string, string>, gen = { phrase: newBip39Phrase, evmKey: () => `0x${randomBytes(32).toString('hex')}` }): string[] {
  const add: string[] = [];
  for (const key of [SECRET_KEYS.bchMainnet, SECRET_KEYS.bchChipnet]) {
    const v = env.get(key);
    if (v === undefined || v === '') add.push(`${key}="${gen.phrase()}"`);
    else if (!isValidBip39Phrase(v)) throw new Error(`${key} is set but is not a valid BIP39 phrase; fix it by hand`);
  }
  const k = env.get(SECRET_KEYS.evm);
  if (k === undefined || k === '') add.push(`${SECRET_KEYS.evm}=${gen.evmKey()}`);
  else if (!isValidEvmKey(k)) throw new Error(`${SECRET_KEYS.evm} is set but is not 0x + 64 hex digits; fix it by hand`);
  return add;
}

export function ensureSecrets(file: string): Map<string, string> {
  const before = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const add = missingSecrets(parseEnv(before));
  if (add.length > 0) {
    const sep = before === '' || before.endsWith('\n') ? '' : '\n';
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${before}${sep}# test wallets (tools/test-wallet/keys.ts)\n${add.join('\n')}\n`, { mode: 0o600 });
    renameSync(tmp, file);
  }
  chmodSync(file, 0o600);
  return parseEnv(readFileSync(file, 'utf8'));
}

function main(): void {
  const file = path.resolve(process.env.SAMPAN_ENV_FILE ?? '.env');
  const env = ensureSecrets(file);
  const main = deriveBchKey(env.get(SECRET_KEYS.bchMainnet) ?? '', 'mainnet');
  const chip = deriveBchKey(env.get(SECRET_KEYS.bchChipnet) ?? '', 'chipnet');
  console.log(`path ${BCH_RECEIVE_PATH}`);
  console.log(`bch mainnet  ${main.address}`);
  console.log(`bch tokens   ${main.tokenAddress}`);
  console.log(`bch chipnet  ${chip.address}`);
  console.log(`evm          ${evmAddress(env.get(SECRET_KEYS.evm) ?? '')}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) main();
