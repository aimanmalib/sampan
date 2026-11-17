// PUSD to USDC over the atomic swap route: the user's BCH wallet pays the swap contract what the swap client's
// paymentRequest names (the PUSD amount plus BCH for the contract's own claim or refund fee). The page builds the
// payment from the wallet's coins, checks it with checkTransaction against that request, asks the wallet to sign,
// and sends it through the server's relay. The contract address must be a token-aware P2SH32 address.
import { parseAddress, type CashPrefix } from '../address.js';
import { checkTransaction } from '../check.js';
import { buildTokenPayment } from '../tx/token-payment.js';
import { outputToWire, txToHex } from '../wire.js';
import type { Api } from './api.js';
import type { WalletView } from './scan.js';
import type { WalletSession } from './session.js';
import { CheckFailure } from './swap.js';

/** What the swap client asks the user's BCH wallet to send (client/swap.ts PaymentRequest). */
export interface ContractPayment {
  address: string;
  tokenUnits: bigint;
  category: string;
  sats: bigint;
}

const P2SH32 = /^aa20[0-9a-f]{64}87$/;

/** The contract's locking bytecode, or null when the address is not a token-aware P2SH32 address on this network. */
export function contractLock(address: string, prefix: CashPrefix): string | null {
  const parsed = parseAddress(address, prefix);
  if (typeof parsed === 'string' || !parsed.tokenAware || !P2SH32.test(parsed.lockingHex)) return null;
  return parsed.lockingHex;
}

export async function payContract(o: {
  api: Api;
  session: WalletSession;
  wallet: WalletView;
  payment: ContractPayment;
  prefix: CashPrefix;
  satsPerByte: bigint;
  feeCapSats: bigint;
  tokenDustSats: bigint;
  /** One sentence the wallet shows. */
  userPrompt: string;
  onStep?: (step: 'checking' | 'signing' | 'sending') => void;
}): Promise<string> {
  const { wallet, payment } = o;
  const lock = contractLock(payment.address, o.prefix);
  if (!lock) throw new CheckFailure(3, 'the swap contract address is not a token-aware P2SH32 address');
  const category = payment.category.toLowerCase();
  const built = buildTokenPayment({
    coins: wallet.coins.map((c) => ({ txid: c.txid, vout: c.vout, sats: c.sats, lockingHex: c.address.lockingHex, path: `${c.address.path}/${c.address.index}`, token: c.token })),
    to: { lockingHex: lock, sats: payment.sats, category, amount: payment.tokenUnits },
    tokenChangeLockingHex: wallet.change.lockingHex,
    tokenDustSats: o.tokenDustSats,
    changeLockingHex: wallet.change.lockingHex,
    satsPerByte: o.satsPerByte,
  });
  o.onStep?.('checking');
  const result = checkTransaction(built.transaction, built.sourceOutputs, {
    userLockingBytecodes: wallet.derived.map((a) => a.lockingHex),
    inputPaths: built.inputPaths,
    poolOwnerPkhs: [],
    deposits: [{ lockingBytecode: lock, sats: payment.sats, token: { category, amount: payment.tokenUnits } }],
    spend: { sats: payment.sats, tokens: { [category]: payment.tokenUnits } },
    feeCapSats: o.feeCapSats,
  });
  if (!result.ok) throw new CheckFailure(result.rule, result.reason);
  o.onStep?.('signing');
  const signed = await o.session.sign({
    tx: txToHex(built.transaction),
    sourceOutputs: built.sourceOutputs.map(outputToWire),
    inputPaths: built.inputPaths,
    userPrompt: o.userPrompt,
  });
  o.onStep?.('sending');
  const sent = await o.api.post<{ txid: string }>('/api/atom/broadcast', { tx: signed, sourceOutputs: built.sourceOutputs.map(outputToWire) });
  return sent.txid;
}
