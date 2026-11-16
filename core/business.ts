// The business block of config/sampan.json: the Sampan fee on swaps and the inputs of the scenario table.
// Pure. The fee is one plain BCH output to `feeAddress`, worth `feeBps` of the BCH side of the trade, left
// out when it would be dust. It is 0 on the public site during the event; tests switch it on locally.
import { parseAddress, type CashPrefix } from './address.js';
import { BCH_DUST_SATS } from './tx/types.js';

export interface BusinessSource {
  key: string;
  label: string;
  value: number | string;
  unit: string;
  /** Where the number was read, and the day it was read (YYYY-MM-DD). */
  url: string;
  read: string;
}

export interface BusinessConfig {
  /** Sampan fee on a swap, in basis points of the BCH side. */
  feeBps: number;
  /** Plain (P2PKH) cash address that receives the fee. */
  feeAddress: string;
  /** Fee used by the scenario table (arithmetic, not a forecast). */
  scenarioBps: number;
  /** Shares of each source value the scenario table multiplies by (0 < share <= 1). */
  scenarioShares: number[];
  sources: BusinessSource[];
}

/** The fee for a trade whose BCH side is `bchSats`: 0 when the fee is off or would be dust. */
export function sampanFeeSats(bchSats: bigint, feeBps: number): bigint {
  if (feeBps <= 0 || bchSats <= 0n) return 0n;
  const fee = (bchSats * BigInt(feeBps)) / 10_000n;
  return fee < BCH_DUST_SATS ? 0n : fee;
}

/** Locking bytecode (hex) of the fee address, or undefined when the fee is off. Throws on a bad address. */
export function feeLockingHex(b: Pick<BusinessConfig, 'feeBps' | 'feeAddress'>, prefix: CashPrefix): string | undefined {
  if (b.feeBps <= 0) return undefined;
  const p = parseAddress(b.feeAddress, prefix);
  if (typeof p === 'string') throw new Error(`business.feeAddress: ${p}`);
  return p.lockingHex;
}

export const prefixOf = (address: string): CashPrefix => (address.startsWith('bchtest:') ? 'bchtest' : 'bitcoincash');

const P2PKH_HEX = /^76a914[0-9a-f]{40}88ac$/;

export function validateBusiness(b: BusinessConfig | undefined): string[] {
  if (!b) return ['business: missing'];
  const errors: string[] = [];
  const need = (ok: boolean, message: string): void => {
    if (!ok) errors.push(message);
  };
  need(Number.isInteger(b.feeBps) && b.feeBps >= 0 && b.feeBps <= 500, 'business.feeBps: integer from 0 to 500');
  const parsed = parseAddress(b.feeAddress, prefixOf(b.feeAddress));
  need(typeof parsed !== 'string' && P2PKH_HEX.test(parsed.lockingHex), 'business.feeAddress: a P2PKH cash address');
  need(Number.isInteger(b.scenarioBps) && b.scenarioBps >= 1 && b.scenarioBps <= 100, 'business.scenarioBps: integer from 1 to 100');
  need(
    Array.isArray(b.scenarioShares) && b.scenarioShares.length > 0 && b.scenarioShares.every((s) => s > 0 && s <= 1),
    'business.scenarioShares: shares above 0 and at most 1',
  );
  need(Array.isArray(b.sources), 'business.sources: a list');
  for (const s of b.sources ?? []) {
    need(/^https:\/\/\S+$/.test(s.url) && /^\d{4}-\d{2}-\d{2}$/.test(s.read), `business.sources.${s.key}: https url and read date`);
  }
  return errors;
}
