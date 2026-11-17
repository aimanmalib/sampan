// One atomic swap run from this page, in the order the service's integration note gives: startSwap, recovery card,
// lockOnBase, poll the swap, makerLockReady, claim. Every lock, contract and secret step is the client's own function;
// this file only builds the client's dependencies, orders the calls and refuses to lock before the recovery card was
// downloaded (the card holds the secret and is enough to claim or refund without this page or the service).
import type { AtomDeps, AtomEip1193, AtomSaved, AtomShippedConfig, AtomSwapModule, AtomSwapView } from './client.js';

/** States after which the service no longer changes the swap. */
export const FINAL_STATES: readonly string[] = ['done', 'refunded', 'expired', 'failed'];
/** Problems that clear by themselves while the maker's lock gets its confirmations. */
const WAITING_PROBLEMS = ['not-locked', 'not-confirmed'];
/** Problems the client finds in the maker's offer before anything is signed. */
const OFFER_PROBLEMS = ['wrong-contract', 'wrong-token', 'wrong-hash', 'wrong-id', 'wrong-amount', 'wrong-refund', 'wrong-timeout', 'timeout-too-far'];

export class CardFirst extends Error {
  constructor() {
    super('card-first');
  }
}

/** The client's dependencies, from its own pieces: maker API, Base reader, Electrum and the card store. */
export function atomDeps(client: AtomSwapModule, shipped: AtomShippedConfig, apiPath: string, storage: Pick<Storage, 'getItem' | 'setItem'>): AtomDeps {
  const servers = shipped.bch.network === 'mainnet' ? shipped.electrum.servers : shipped.electrum.chipnetServers;
  return {
    config: shipped,
    api: client.makerApi(apiPath),
    base: client.baseReader(shipped),
    bch: () => client.connectElectrum(servers, shipped.electrum.timeoutMs),
    store: client.cardStore(storage, shipped.client.storageKey),
  };
}

/** A short reason code from any error: API refusals, failed checks, wallet errors and user rejections. */
export function codeOf(e: unknown): string {
  if (e && typeof e === 'object') {
    const x = e as { reason?: unknown; code?: unknown; message?: unknown };
    if (typeof x.reason === 'string') return x.reason;
    if (x.code === 4001) return 'rejected';
    if (typeof x.message === 'string' && /^[a-z-]+$/.test(x.message)) return x.message;
  }
  return 'other';
}

/** A decimal amount without trailing zeros ("2.000000" reads "2"); the client prints every decimal place. */
export const shortAmount = (text: string): string => (text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text);

/** Whether a code comes from the page's checks of the maker's offer (nothing was signed). */
export const offerProblem = (code: string): boolean => OFFER_PROBLEMS.includes(code);

/** The recovery card as a file to save. */
export function cardFile(client: AtomSwapModule, saved: AtomSaved): { name: string; text: string } {
  return { name: `sampan-recovery-${saved.card.secret.hash.slice(0, 12)}.json`, text: client.cardToJson(saved.card) };
}

/** USDC to PUSD: approve and lock through the user's wallet, only once this swap's card was downloaded. */
export async function lockUsdc(
  client: AtomSwapModule,
  deps: AtomDeps,
  saved: AtomSaved,
  downloaded: ReadonlySet<string>,
  wallet: AtomEip1193,
  onStep: (step: 'approve' | 'lock') => void,
): Promise<string> {
  if (!downloaded.has(saved.card.secret.hash)) throw new CardFirst();
  return client.lockOnBase(deps.config, saved, wallet, onStep);
}

export type Activity = 'checking' | 'claiming' | null;

export interface TickResult {
  swap: AtomSwapView;
  activity: Activity;
  /** A maker-side problem that stops the claim (the page never sends the secret then). */
  problem: string | null;
  final: boolean;
}

/**
 * One poll of the swap. When the service reports the maker's lock, the page checks it on chain itself and only then
 * sends the secret; `claimed` keeps a claim from being sent twice while the service catches up.
 */
export async function tick(client: AtomSwapModule, deps: AtomDeps, saved: AtomSaved, claimed: Set<string>): Promise<TickResult> {
  const hash = saved.card.secret.hash;
  let swap = await deps.api.swap(hash);
  let activity: Activity = null;
  let problem: string | null = null;
  if (swap.state === 'makerLocked' && !swap.tx.userClaim && !claimed.has(hash)) {
    const found = await client.makerLockReady(deps, saved, swap);
    if (found && WAITING_PROBLEMS.includes(found)) activity = 'checking';
    else if (found) problem = found;
    else {
      claimed.add(hash);
      try {
        swap = await client.claim(deps, saved);
        activity = 'claiming';
      } catch (e) {
        claimed.delete(hash);
        problem = codeOf(e);
      }
    }
  }
  return { swap, activity, problem, final: FINAL_STATES.includes(swap.state) };
}
