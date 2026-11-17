// Measured crossings (KP17): follows one crossing from its first transaction until the funds arrive on the other
// chain, and returns one Runs row whose txid cell names both chains' transactions in full.
//   out:      BCH deposit to the THORChain vault -> stablecoin transfer on the asset's EVM chain to the 0x destination
//   in, g3a:  router deposit on the asset's EVM chain -> BCH paid to the destination address (and, for a landing
//             address, the conversion that pays the owner, when a `convert` lookup is given)
// `seconds` runs from the first broadcast until arrival is seen on the second chain. A crossing the route calls
// done without a transaction on the expected chain, or whose transaction does not pay the destination, is a fail.
//
//   npx tsx tools/measure/cross.ts --asset <THORChain asset from config> --flow out --txid <bch txid> --to 0x… \
//     --broadcast <ISO time> --amount "…" [--write]
//   npx tsx tools/measure/cross.ts --asset <…> --flow in --txid 0x… --to bitcoincash:… --broadcast <ISO time> --amount "…" [--write]
// The asset names the EVM chain (its config entry gives the token contract and the RPC endpoints, tried in order).
import { pathToFileURL } from 'node:url';
import { parseAddress } from '../../core/address.js';
import { ElectrumChain } from '../../server/chain/electrum.js';
import type { SampanConfig } from '../../core/config.js';
import { loadConfig } from '../../server/config.js';
import { ThorchainRoute } from '../../server/routes/thorchain.js';
import { Thornode } from '../../server/routes/thornode.js';
import type { CrossingStatus } from '../../server/routes/types.js';
import { appendRuns, crossingTxid, type Run } from './runs.js';

export type CrossFlow = 'out' | 'in' | 'g3a';

/** keccak256("Transfer(address,address,uint256)") */
export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

export interface EvmReceipt {
  status: string;
  logs: Array<{ address: string; topics: string[] }>;
}

export interface Crossing {
  flow: CrossFlow;
  /** The route's key of the EVM chain on the other side (ETH, BSC, AVAX, BASE). */
  chain: string;
  /** BCH txid (out) or EVM transaction hash (in, g3a). */
  firstTxid: string;
  broadcastAt: Date;
  amount: string;
  /** 0x address (out) or the BCH locking bytecode hex that must receive the BCH (in, g3a). */
  destination: string;
  /** Token contract on that chain that must arrive (out). */
  token?: string;
}

export interface CrossDeps {
  status(txid: string): Promise<CrossingStatus>;
  evmReceipt(hash: string): Promise<EvmReceipt | null>;
  bchHistory(lockingHex: string): Promise<string[]>;
  /** For a landing address: the conversion txid once the finisher has paid the owner, else undefined. */
  convert?: (bchTxid: string) => Promise<string | undefined>;
  now(): number;
  sleep(ms: number): Promise<void>;
  pollMs: number;
  timeoutMs: number;
}

const evmHash = (id: string): string => `0x${id.replace(/^0x/i, '').toLowerCase()}`;
/** `bch <txid>` or `<chain> 0x<hash>` for a transaction named only in a note. */
const refundRef = (chain: string | undefined, id: string): string =>
  chain === 'BCH' ? `bch ${id.toLowerCase()}` : `${(chain ?? 'unknown').toLowerCase()} ${evmHash(id)}`;
const pad32 = (address: string): string => `0x${address.replace(/^0x/i, '').toLowerCase().padStart(64, '0')}`;

/** True when the receipt succeeded and carries a Transfer of `token` to `to`. */
export function paysTo(receipt: EvmReceipt, token: string, to: string): boolean {
  if (receipt.status !== '0x1') return false;
  return receipt.logs.some(
    (l) => l.address.toLowerCase() === token.toLowerCase() && l.topics[0]?.toLowerCase() === TRANSFER_TOPIC && l.topics[2]?.toLowerCase() === pad32(to),
  );
}

export async function traceCrossing(c: Crossing, d: CrossDeps): Promise<Run> {
  const out = c.flow === 'out';
  if (out && !c.token) throw new Error('an out crossing needs the token contract');
  const wantChain = out ? c.chain : 'BCH';
  const first = out ? c.firstTxid.toLowerCase() : evmHash(c.firstTxid);
  const row = (ok: boolean, second?: string, convert?: string, note?: string): Run => {
    const ids = second
      ? out
        ? { bch: first, evm: { chain: c.chain, hash: evmHash(second) } }
        : { bch: second.toLowerCase(), evm: { chain: c.chain, hash: first } }
      : undefined;
    const txid = ids ? crossingTxid(convert ? { ...ids, convert } : ids) : first;
    const seconds = ok ? (d.now() - c.broadcastAt.getTime()) / 1000 : undefined;
    return { utc: c.broadcastAt, flow: c.flow, amount: c.amount, txid, ok, ...(seconds === undefined ? {} : { seconds }), ...(note ? { note } : {}) };
  };

  const deadline = d.now() + d.timeoutMs;
  let stage = 'not seen by the route';
  let second: string | undefined;
  while (d.now() < deadline) {
    let s: CrossingStatus | undefined;
    try {
      s = await d.status(first);
    } catch {
      s = undefined; // the route did not answer this time; ask again
    }
    if (s?.stage === 'refunded') {
      // A refund usually goes back on the first chain: only a transaction on the expected chain fills the second cell.
      if (s.outTxid && s.outChain === wantChain) return row(false, s.outTxid, undefined, 'refunded by the route');
      return row(false, undefined, undefined, s.outTxid ? `refunded by the route (${refundRef(s.outChain, s.outTxid)})` : 'refunded by the route');
    }
    if (s?.stage === 'pending') stage = 'swapping';
    if (s?.stage === 'done') {
      if (!s.outTxid || s.outChain !== wantChain) return row(false, undefined, undefined, `route reports done without a ${wantChain} transaction`);
      second = s.outTxid;
      stage = `waiting for ${wantChain} transaction`;
      if (out) {
        const receipt = await d.evmReceipt(evmHash(second)).catch(() => null);
        if (receipt) {
          if (!paysTo(receipt, c.token!, c.destination)) return row(false, second, undefined, `the ${c.chain} transaction does not pay the destination`);
          return row(true, second);
        }
      } else if ((await d.bchHistory(c.destination).catch((): string[] => [])).includes(second.toLowerCase())) {
        if (!d.convert) return row(true, second);
        stage = 'waiting for the conversion';
        const convert = await d.convert(second).catch(() => undefined);
        if (convert) return row(true, second, convert);
      }
    }
    await d.sleep(d.pollMs);
  }
  return row(false, second, undefined, `nothing arrived in ${Math.round(d.timeoutMs / 60_000)} min (${stage})`);
}

/** Minimal JSON-RPC client for the receipt over the chain's configured endpoints, tried in order. */
export const evmReceiptFrom =
  (rpcs: string[]) =>
  async (hash: string): Promise<EvmReceipt | null> => {
    let last: unknown;
    for (const rpc of rpcs) {
      try {
        const res = await fetch(rpc, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [hash] }),
          signal: AbortSignal.timeout(15_000),
        });
        const body = (await res.json()) as { result?: EvmReceipt | null };
        return body.result ?? null;
      } catch (e) {
        last = e;
      }
    }
    throw last;
  };

/** The config entries an asset name points at: its chain and, on an EVM chain, the token and RPC endpoints. */
export function crossingAsset(config: SampanConfig, asset: string): { chain: string; token: string; rpc: string[] } {
  const a = config.thorchain.assets.find((x) => x.asset === asset);
  if (!a) throw new Error(`${asset} is not in config thorchain.assets`);
  const evm = config.evm.chains.find((ch) => ch.key === a.chain);
  const token = evm?.tokens[a.symbol];
  if (!evm || !token) throw new Error(`${asset}: no evm.chains entry with ${a.symbol} for ${a.chain}`);
  return { chain: a.chain, token: token.address, rpc: evm.rpc };
}

async function main(): Promise<void> {
  const arg = (name: string): string | undefined => {
    const i = process.argv.indexOf(name);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const need = (name: string): string => arg(name) ?? (() => { throw new Error(`${name} is required`); })();
  const flow = need('--flow') as CrossFlow;
  if (!['out', 'in', 'g3a'].includes(flow)) throw new Error('--flow is out, in or g3a');
  const config = loadConfig('config/sampan.json');
  const { chain: evmChain, token, rpc } = crossingAsset(config, need('--asset'));
  let destination = need('--to');
  if (flow !== 'out') {
    const parsed = parseAddress(destination, 'bitcoincash');
    if (typeof parsed === 'string') throw new Error(parsed);
    destination = parsed.lockingHex;
  }
  const route = new ThorchainRoute({ node: new Thornode(config.thorchain.nodes, undefined, config.thorchain.timeoutMs), slippageBps: 0, minSatsPerByte: 1n });
  const chain = new ElectrumChain(config.electrum.servers);
  try {
    const run = await traceCrossing(
      { flow, chain: evmChain, firstTxid: need('--txid'), broadcastAt: new Date(need('--broadcast')), amount: need('--amount'), destination, token },
      {
        status: (t) => route.status(t),
        evmReceipt: evmReceiptFrom(rpc),
        bchHistory: (l) => chain.historyTxids(l),
        now: Date.now,
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        pollMs: Number(arg('--poll') ?? '15') * 1000,
        timeoutMs: Number(arg('--timeout') ?? '60') * 60_000,
      },
    );
    console.log(JSON.stringify({ ...run, utc: run.utc.toISOString() }));
    if (process.argv.includes('--write')) appendRuns('docs/MEASURED.md', [run]);
  } finally {
    await chain.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
