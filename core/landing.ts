// Landing contract (contracts/landing.cash): parameters, redeem script, P2SH20 address and the recovery card.
// Pure: no I/O. The server and the page both compute the address here, and the page refuses an address that
// differs from its own result. The compiled script comes from the committed CashScript artifact.
import {
  bigIntToVmNumber,
  binToHex,
  encodeDataPush,
  encodeLockingBytecodeP2sh20,
  hash160,
  hexToBin,
  lockingBytecodeToCashAddress,
  OpcodesBch,
} from '@bitauth/libauth';
import artifact from '../contracts/landing.json' with { type: 'json' };
import type { CashPrefix } from './address.js';

/** Contract parameters as a person reads them (category in the hex order explorers and indexers show). */
export interface LandingParams {
  /** Full locking bytecode of the owner's address, hex (25-byte P2PKH or 23-byte P2SH). */
  ownerLockHex: string;
  /** Token category id as shown by explorers (display order). */
  category: string;
  rateNum: bigint;
  rateDen: bigint;
  returnAfter: number;
}

export const LANDING_RATE_DEN = 100_000_000n;
/**
 * Widest nonce a payment invoice may add to rateDen (config pay.maxNonce is at most this). A plain landing keeps
 * rateDen at LANDING_RATE_DEN; an invoice uses LANDING_RATE_DEN + nonce so each invoice gets its own address
 * from the same contract (docs/decisions/0027-sampan-pay-invoices.md).
 */
export const LANDING_NONCE_CEILING = 1_000_000;
/** giveBack may keep at most this many satoshis as the miner fee (fixed in the contract source). */
export const GIVE_BACK_MAX_FEE_SATS = 1000n;
export const LANDING_FUNCTIONS = { convert: 0, giveBack: 1 } as const;
export type LandingFunction = keyof typeof LANDING_FUNCTIONS;

const HEX = /^[0-9a-f]*$/;

/** Compiled contract body (without constructor arguments), from the artifact's ASM. */
export const landingBodyBytecode = (asm: string = artifact.bytecode): Uint8Array => {
  const out: number[] = [];
  for (const token of asm.trim().split(/\s+/)) {
    if (token.startsWith('OP_')) {
      const op = (OpcodesBch as unknown as Record<string, number | string | undefined>)[token];
      if (typeof op !== 'number') throw new Error(`unknown opcode ${token}`);
      out.push(op);
    } else if (HEX.test(token) && token.length % 2 === 0) {
      out.push(...encodeDataPush(hexToBin(token)));
    } else {
      throw new Error(`unexpected token ${token} in contract bytecode`);
    }
  }
  return Uint8Array.from(out);
};

const BODY = landingBodyBytecode();

/** Explorer order <-> transaction byte order (the order OP_OUTPUTTOKENCATEGORY pushes). */
export const categoryToScriptOrder = (displayHex: string): Uint8Array => hexToBin(displayHex).reverse();

/**
 * Checks the parameters; returns a reason when they are not usable. rateDen must be LANDING_RATE_DEN, or
 * LANDING_RATE_DEN + 1 to LANDING_RATE_DEN + `maxNonce` for an invoice address (maxNonce 0: plain landings only).
 */
export function landingParamsProblem(p: LandingParams, maxNonce = 0): string | undefined {
  const lock = p.ownerLockHex.toLowerCase();
  if (!HEX.test(lock)) return 'owner lock is not hex';
  const isP2pkh = lock.length === 50 && lock.startsWith('76a914') && lock.endsWith('88ac');
  const isP2sh20 = lock.length === 46 && lock.startsWith('a914') && lock.endsWith('87');
  if (!isP2pkh && !isP2sh20) return 'owner lock must be a full P2PKH or P2SH20 locking bytecode';
  if (!/^[0-9a-f]{64}$/.test(p.category.toLowerCase())) return 'token category must be 32 bytes of hex';
  if (p.rateNum <= 0n) return 'rateNum must be positive';
  const nonce = p.rateDen - LANDING_RATE_DEN;
  const ceiling = BigInt(Math.min(Math.max(0, Math.floor(maxNonce)), LANDING_NONCE_CEILING));
  if (nonce < 0n || nonce > ceiling)
    return ceiling === 0n ? `rateDen must be ${LANDING_RATE_DEN}` : `rateDen must be ${LANDING_RATE_DEN} to ${LANDING_RATE_DEN + ceiling}`;
  if (!Number.isInteger(p.returnAfter) || p.returnAfter < 1 || p.returnAfter > 0xffff) return 'returnAfter must be 1..65535 blocks';
  return undefined;
}

/** Constructor arguments in source order, encoded as CashScript does (bytes as is, ints as VM numbers). */
const encodedArgs = (p: LandingParams): Uint8Array[] => [
  hexToBin(p.ownerLockHex.toLowerCase()),
  categoryToScriptOrder(p.category.toLowerCase()),
  bigIntToVmNumber(p.rateNum),
  bigIntToVmNumber(p.rateDen),
  bigIntToVmNumber(BigInt(p.returnAfter)),
];

/** Redeem script: arguments pushed last-first, then the compiled body. */
export function landingRedeemScript(p: LandingParams): Uint8Array {
  // Callers decide which nonces they accept (readCard, the invoice service); the script itself takes any in range.
  const problem = landingParamsProblem(p, LANDING_NONCE_CEILING);
  if (problem) throw new Error(problem);
  const pushes = encodedArgs(p)
    .reverse()
    .flatMap((a) => [...encodeDataPush(a)]);
  return Uint8Array.from([...pushes, ...BODY]);
}

export const landingLockingBytecode = (p: LandingParams): Uint8Array => encodeLockingBytecodeP2sh20(hash160(landingRedeemScript(p)));

/** Plain (non-token) P2SH address: what wallets and exchanges pay BCH to. */
export function landingAddress(p: LandingParams, prefix: CashPrefix): string {
  const res = lockingBytecodeToCashAddress({ bytecode: landingLockingBytecode(p), prefix, tokenSupport: false });
  if (typeof res === 'string') throw new Error(res);
  return res.address;
}

/** Unlocking bytecode for a function: selector, then the redeem script. Neither function takes arguments. */
export const landingUnlocking = (p: LandingParams, fn: LandingFunction): Uint8Array =>
  Uint8Array.from([...encodeDataPush(bigIntToVmNumber(BigInt(LANDING_FUNCTIONS[fn]))), ...encodeDataPush(landingRedeemScript(p))]);

/** rateNum for a minimum of `tokensMin` base units per `minBch` satoshis (PRD flow L step 2), rounded down. */
export function rateNumFor(tokensMin: bigint, minBchSats: bigint): bigint {
  if (tokensMin <= 0n || minBchSats <= 0n) throw new RangeError('tokensMin and minBch must be positive');
  return (tokensMin * LANDING_RATE_DEN) / minBchSats;
}

/** Fewest tokens convert accepts for a landing coin of `sats` (the contract's inequality, rounded up). */
export const minTokensFor = (p: Pick<LandingParams, 'rateNum' | 'rateDen'>, sats: bigint): bigint =>
  (sats * p.rateNum + p.rateDen - 1n) / p.rateDen;

export const landingLockingHex = (p: LandingParams): string => binToHex(landingLockingBytecode(p));
