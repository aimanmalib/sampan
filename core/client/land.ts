// Flow L as the page runs it. Opening: the server sends a recovery card; this browser recomputes the landing
// address from the card's parameters and refuses it unless the owner, token and wait match what was asked.
// Paying from a connected wallet: the server builds a plain payment, this browser checks it against the landing
// lock it computed itself and the amount it showed, and only then asks the wallet to sign.
import { checkTransaction } from '../check.js';
import { parseAddress, type CashPrefix } from '../address.js';
import { readCard, type LandingCard } from '../landing-card.js';
import { landingLockingHex, type LandingParams } from '../landing.js';
import { outputFromWire, txFromHex, type WireOutput } from '../wire.js';
import { ApiFailure, type Api } from './api.js';
import type { WalletView } from './scan.js';
import type { WalletSession } from './session.js';
import { CheckFailure, type SwapStep } from './swap.js';

export interface OpenedLanding {
  crossingId: string;
  card: LandingCard;
  params: LandingParams;
  /** Landing lock computed in this browser. */
  lockHex: string;
  minSats: bigint;
  tokensMin: bigint;
  validHours: number;
}

export class LandingMismatch extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'LandingMismatch';
  }
}

interface OpenReply {
  crossingId: string;
  card: unknown;
  minSats: string;
  tokensMin: string;
  validHours: number;
}

/** What this page asked for; the card must agree on every point. */
export interface LandingAsk {
  ownerAddress: string;
  token: string;
  category: string;
  returnAfter: number;
  prefix: CashPrefix;
}

export function acceptCard(raw: unknown, ask: LandingAsk): { card: LandingCard; params: LandingParams } {
  const read = readCard(raw);
  if (typeof read === 'string') throw new LandingMismatch(read);
  const owner = parseAddress(ask.ownerAddress, ask.prefix);
  if (typeof owner === 'string') throw new LandingMismatch(owner);
  if (read.params.ownerLockHex !== owner.lockingHex) throw new LandingMismatch('the card pays someone else');
  if (read.params.category !== ask.category.toLowerCase()) throw new LandingMismatch('the card is for another token');
  if (read.params.returnAfter !== ask.returnAfter) throw new LandingMismatch('the card waits a different number of blocks');
  return read;
}

export async function openLanding(api: Api, ask: LandingAsk): Promise<OpenedLanding> {
  const reply = await api.post<OpenReply>('/api/land/open', { ownerAddress: ask.ownerAddress, token: ask.token });
  const { card, params } = acceptCard(reply.card, ask);
  return {
    crossingId: reply.crossingId,
    card,
    params,
    lockHex: landingLockingHex(params),
    minSats: BigInt(reply.minSats),
    tokensMin: BigInt(reply.tokensMin),
    validHours: reply.validHours,
  };
}

interface PayReply {
  crossingId: string;
  tx: string;
  sourceOutputs: WireOutput[];
  inputPaths: Array<{ inputIndex: number; path: string }>;
  feeSats: string;
}

export async function payLanding(o: {
  api: Api;
  session: WalletSession;
  wallet: WalletView;
  landing: OpenedLanding;
  sats: bigint;
  feeCapSats: bigint;
  userPrompt: string;
  onStep?: (step: SwapStep) => void;
}): Promise<{ txid: string }> {
  const { api, wallet, landing, sats } = o;
  const plain = wallet.coins.filter((c) => !c.token);
  const listed = [...plain.map((c) => c.address), wallet.change];
  const addresses = [...new Map(listed.map((a) => [a.address, { address: a.address, path: `${a.path}/${a.index}` }])).values()];
  for (let tries = 0; tries < 2; tries++) {
    o.onStep?.('building');
    const b = await api.post<PayReply>('/api/land/pay/build', {
      crossingId: landing.crossingId,
      amount: sats.toString(),
      addresses,
      changeAddress: wallet.change.address,
    });
    o.onStep?.('checking');
    const pathsOk = b.inputPaths.every((p) => {
      const src = b.sourceOutputs[p.inputIndex];
      const addr = wallet.derived.find((a) => `${a.path}/${a.index}` === p.path);
      return !!src && !!addr && src.lockingBytecode === addr.lockingHex;
    });
    if (!pathsOk) throw new CheckFailure(5, 'an input path does not match the coin it spends');
    const result = checkTransaction(txFromHex(b.tx), b.sourceOutputs.map(outputFromWire), {
      userLockingBytecodes: wallet.derived.map((a) => a.lockingHex),
      inputPaths: b.inputPaths,
      poolOwnerPkhs: [],
      deposits: [{ lockingBytecode: landing.lockHex, sats }],
      spend: { sats, tokens: {} },
      feeCapSats: o.feeCapSats,
      receive: { category: landing.params.category, min: 0n },
    });
    if (!result.ok) throw new CheckFailure(result.rule, result.reason);
    o.onStep?.('signing');
    const signed = await o.session.sign({ tx: b.tx, sourceOutputs: b.sourceOutputs, inputPaths: b.inputPaths, userPrompt: o.userPrompt });
    o.onStep?.('sending');
    try {
      return await api.post<{ txid: string }>('/api/broadcast', { crossingId: landing.crossingId, tx: signed });
    } catch (e) {
      if (!(e instanceof ApiFailure && e.code === 'stale_inputs')) throw e;
    }
  }
  throw new ApiFailure(409, 'stale_inputs', 'the wallet coins changed; try again');
}

/** BIP21 payment link for wallets and QR codes. */
export const bip21 = (address: string, amountBch: string): string => (amountBch ? `${address}?amount=${amountBch}` : address);
