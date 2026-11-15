// Recovery card: the public parameters of one landing address, as JSON. With the card and the open-source
// finisher anyone can finish a landing (convert, or give the BCH back) without the Sampan server. Pure.
import { base64ToBin, binToBase64, binToUtf8, hexToBin, isBase64, lockingBytecodeToCashAddress, utf8ToBin } from '@bitauth/libauth';
import type { CashPrefix } from './address.js';
import { landingAddress, landingParamsProblem, type LandingParams } from './landing.js';

export const CARD_KIND = 'sampan-landing';
export const CARD_VERSION = 1;

export interface LandingCard {
  kind: typeof CARD_KIND;
  version: typeof CARD_VERSION;
  network: 'mainnet' | 'chipnet';
  /** P2SH20 address the BCH is paid to. Recomputed from the fields below on every read. */
  address: string;
  /** The owner's address (where tokens or returned BCH go) and its full locking bytecode. */
  ownerAddress: string;
  ownerLockHex: string;
  /** Token category id in explorer order, and a label for people. */
  category: string;
  token: string;
  /** Integers as decimal strings so no reader rounds them. */
  rateNum: string;
  rateDen: string;
  returnAfter: number;
  /** ISO time the address was made; payments well after it may be returned instead of converted. */
  created: string;
}

export const prefixOf = (network: LandingCard['network']): CashPrefix => (network === 'mainnet' ? 'bitcoincash' : 'bchtest');

export const paramsOf = (c: Pick<LandingCard, 'ownerLockHex' | 'category' | 'rateNum' | 'rateDen' | 'returnAfter'>): LandingParams => ({
  ownerLockHex: c.ownerLockHex.toLowerCase(),
  category: c.category.toLowerCase(),
  rateNum: BigInt(c.rateNum),
  rateDen: BigInt(c.rateDen),
  returnAfter: c.returnAfter,
});

export function makeCard(p: LandingParams, o: { network: LandingCard['network']; token: string; created: Date }): LandingCard {
  const prefix = prefixOf(o.network);
  const owner = lockingBytecodeToCashAddress({ bytecode: hexToBin(p.ownerLockHex), prefix, tokenSupport: true });
  if (typeof owner === 'string') throw new Error(owner);
  return {
    kind: CARD_KIND,
    version: CARD_VERSION,
    network: o.network,
    address: landingAddress(p, prefix),
    ownerAddress: owner.address,
    ownerLockHex: p.ownerLockHex.toLowerCase(),
    category: p.category.toLowerCase(),
    token: o.token,
    rateNum: p.rateNum.toString(),
    rateDen: p.rateDen.toString(),
    returnAfter: p.returnAfter,
    created: o.created.toISOString(),
  };
}

const DECIMAL = /^[0-9]{1,30}$/;

/**
 * Reads a card from untrusted JSON. Returns the card and its parameters, or a reason. The stated address must
 * equal the one recomputed from the parameters, so a card cannot point at a different contract.
 */
export function readCard(raw: unknown): { card: LandingCard; params: LandingParams } | string {
  if (typeof raw !== 'object' || raw === null) return 'card is not a JSON object';
  const c = raw as Record<string, unknown>;
  if (c.kind !== CARD_KIND || c.version !== CARD_VERSION) return `not a ${CARD_KIND} card version ${CARD_VERSION}`;
  if (c.network !== 'mainnet' && c.network !== 'chipnet') return 'network must be mainnet or chipnet';
  for (const k of ['address', 'ownerAddress', 'ownerLockHex', 'category', 'token', 'rateNum', 'rateDen', 'created'] as const) {
    if (typeof c[k] !== 'string') return `${k} must be a string`;
  }
  if (!DECIMAL.test(c.rateNum as string) || !DECIMAL.test(c.rateDen as string)) return 'rateNum and rateDen must be decimal integers';
  if (typeof c.returnAfter !== 'number') return 'returnAfter must be a number';
  const card = c as unknown as LandingCard;
  const params = paramsOf(card);
  const problem = landingParamsProblem(params);
  if (problem) return problem;
  const prefix = prefixOf(card.network);
  const owner = lockingBytecodeToCashAddress({ bytecode: hexToBin(params.ownerLockHex), prefix, tokenSupport: true });
  const plainOwner = lockingBytecodeToCashAddress({ bytecode: hexToBin(params.ownerLockHex), prefix, tokenSupport: false });
  const stated = card.ownerAddress.toLowerCase();
  const ownerMatches = [owner, plainOwner].some((a) => typeof a !== 'string' && a.address === stated);
  if (!ownerMatches) return 'ownerAddress does not match ownerLockHex';
  const address = landingAddress(params, prefix);
  if (address !== card.address.toLowerCase()) return `address does not match the parameters (recomputed ${address})`;
  return { card, params };
}

/** The card as it rides in a status link's fragment (`/c/<id>#card=<this>`): base64url of the JSON. */
export function cardToFragment(card: LandingCard): string {
  return binToBase64(utf8ToBin(JSON.stringify(card))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Reads a fragment made by cardToFragment; the result is checked by readCard like any other card. */
export function cardFromFragment(fragment: string): ReturnType<typeof readCard> {
  try {
    const b64 = fragment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    if (!isBase64(padded)) return 'card link is damaged';
    return readCard(JSON.parse(binToUtf8(base64ToBin(padded))));
  } catch {
    return 'card link is damaged';
  }
}
