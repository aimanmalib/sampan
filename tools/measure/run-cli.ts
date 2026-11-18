// What the measured-run scripts (out-run.ts, in-run.ts) share: their command-line reading, how a crossing is traced
// over the route, the EVM chain's RPC and Electrum, and how the script exits.
import type { SampanConfig } from '../../core/config.js';
import type { ElectrumChain } from '../../server/chain/electrum.js';
import { ThorchainRoute } from '../../server/routes/thorchain.js';
import { Thornode } from '../../server/routes/thornode.js';
import { evmReceiptFrom, type CrossDeps } from './cross.js';

export const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
export const need = (name: string): string => arg(name) ?? (() => { throw new Error(`${name} is required`); })();

/** Tracing over THORChain's status, the chain's RPC endpoints and Electrum; --timeout minutes (default 60). */
export function traceDeps(config: SampanConfig, rpc: string[], chain: ElectrumChain): CrossDeps {
  const route = new ThorchainRoute({ node: new Thornode(config.thorchain.nodes, undefined, config.thorchain.timeoutMs), slippageBps: 0, minSatsPerByte: 1n });
  return {
    status: (t) => route.status(t),
    evmReceipt: evmReceiptFrom(rpc),
    bchHistory: (l) => chain.historyTxids(l),
    now: Date.now,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    pollMs: 15_000,
    timeoutMs: Number(arg('--timeout') ?? '60') * 60_000,
  };
}

export function runCli(main: () => Promise<void>): void {
  void main().then(
    () => process.exit(0),
    (e: unknown) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    },
  );
}
