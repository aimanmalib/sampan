// Wallet-side helpers shared by the page and the test wallet: HD paths, addresses from public keys,
// sign-request input paths and decimal amounts. Pure.
import { binToHex, encodeCashAddress, encodeLockingBytecodeP2pkh, hash160 } from '@bitauth/libauth';
import type { CashPrefix } from './address.js';

export const WALLET_PATHS = ['receive', 'change', 'defi'] as const;
export type WalletPath = (typeof WALLET_PATHS)[number];

/** BIP44 child index of each path under m/44'/145'/0' (WizardConnect hdwalletv1 convention). */
export const CHILD_INDEX: Record<WalletPath, number> = { receive: 0, change: 1, defi: 7 };

export interface DerivedAddress {
  path: WalletPath;
  index: number;
  address: string;
  tokenAddress: string;
  lockingHex: string;
}

export function deriveAddress(publicKey: Uint8Array, path: WalletPath, index: number, prefix: CashPrefix): DerivedAddress {
  const payload = hash160(publicKey);
  return {
    path,
    index,
    address: encodeCashAddress({ prefix, type: 'p2pkh', payload }).address,
    tokenAddress: encodeCashAddress({ prefix, type: 'p2pkhWithTokens', payload }).address,
    lockingHex: binToHex(encodeLockingBytecodeP2pkh(payload)),
  };
}

/** "receive/3" -> ["receive", 3]; anything else throws. */
export function splitPath(path: string): [WalletPath, number] {
  const m = /^(receive|change|defi)\/([0-9]{1,6})$/.exec(path);
  if (!m) throw new Error(`not a wallet path: ${path}`);
  return [m[1] as WalletPath, Number(m[2])];
}

/** Server input paths -> the hdwalletv1 sign request form [inputIndex, pathName, addressIndex]. */
export const toWizardInputPaths = (paths: Array<{ inputIndex: number; path: string }>): Array<[number, string, number]> =>
  paths.map((p) => {
    const [name, index] = splitPath(p.path);
    return [p.inputIndex, name, index];
  });

/** "0.001" with 8 decimals -> 100000n. Returns undefined for anything that is not a plain positive decimal. */
export function parseUnits(text: string, decimals: number): bigint | undefined {
  const t = text.trim().replace(',', '.');
  const m = /^([0-9]{0,12})(?:\.([0-9]*))?$/.exec(t);
  if (!m || (m[1] === '' && (m[2] ?? '') === '')) return undefined;
  const frac = m[2] ?? '';
  if (frac.length > decimals) return undefined;
  return BigInt((m[1] || '0') + frac.padEnd(decimals, '0'));
}

/** 100000n with 8 decimals -> "0.001" (trailing zeros dropped, at least `minFraction` digits kept). */
export function formatUnits(value: bigint, decimals: number, minFraction = 0): string {
  const neg = value < 0n;
  const s = (neg ? -value : value).toString().padStart(decimals + 1, '0');
  const whole = s.slice(0, s.length - decimals);
  let frac = s.slice(s.length - decimals).replace(/0+$/, '');
  if (frac.length < minFraction) frac = frac.padEnd(minFraction, '0');
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}
