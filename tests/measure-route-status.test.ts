// The 1Click status reader the measured runs share (tools/measure/run-cli.ts crossingStatus): it reads the page's own
// /api/crossings/:id and names the chain of the far side, so a crossing in is traced to a BCH transaction. No network.
import { describe, expect, it } from 'vitest';
import { traceCrossing, type CrossDeps } from '../tools/measure/cross.js';
import { crossingStatus } from '../tools/measure/run-cli.js';

const ID = 'ab'.repeat(16);
const EVM_HASH = `0x${'cd'.repeat(32)}`;
const BCH_TXID = 'ef'.repeat(32);
const LOCKING = '76a914' + '11'.repeat(20) + '88ac';

const page = (out: unknown) => async (p: string) => {
  expect(p).toBe(`/api/crossings/${ID}`);
  return { kind: 'in', out };
};

describe('crossingStatus', () => {
  it('names the given chain for the transaction the route sent', async () => {
    const s = crossingStatus(page({ stage: 'done', outTxid: BCH_TXID }), ID, 'BCH');
    expect(await s('ignored')).toEqual({ stage: 'done', outTxid: BCH_TXID, outChain: 'BCH' });
  });

  it('leaves the transaction out until the route names one', async () => {
    expect(await crossingStatus(page({ stage: 'pending', outTxid: null }), ID, 'BCH')('x')).toEqual({ stage: 'pending' });
  });

  it('treats an unknown stage or a missing answer as no answer', async () => {
    await expect(crossingStatus(page({ stage: 'unknown' }), ID, 'BCH')('x')).rejects.toThrow('no answer');
    await expect(crossingStatus(page(null), ID, 'BCH')('x')).rejects.toThrow('no answer');
  });

  it('lets a crossing in through 1Click end ok once the BCH reaches the destination', async () => {
    let t = 0;
    const deps: CrossDeps = {
      status: crossingStatus(page({ stage: 'done', outTxid: BCH_TXID }), ID, 'BCH'),
      evmReceipt: async () => null,
      bchHistory: async (l) => (l === LOCKING ? [BCH_TXID] : []),
      now: () => t,
      sleep: async (ms) => {
        t += ms;
      },
      pollMs: 1000,
      timeoutMs: 10_000,
    };
    const run = await traceCrossing({ flow: 'oc-in', chain: 'BASE', firstTxid: EVM_HASH, broadcastAt: new Date(0), amount: '1 USDC', destination: LOCKING }, deps);
    expect(run.ok).toBe(true);
    expect(run.flow).toBe('oc-in');
    expect(run.txid).toContain(BCH_TXID);
    expect(run.txid).toContain(EVM_HASH);
  });

  it('is not ok when the route names its transaction on the wrong chain', async () => {
    let t = 0;
    const deps: CrossDeps = {
      status: crossingStatus(page({ stage: 'done', outTxid: BCH_TXID }), ID, 'BASE'),
      evmReceipt: async () => null,
      bchHistory: async () => [BCH_TXID],
      now: () => t,
      sleep: async (ms) => {
        t += ms;
      },
      pollMs: 1000,
      timeoutMs: 10_000,
    };
    const run = await traceCrossing({ flow: 'oc-in', chain: 'BASE', firstTxid: EVM_HASH, broadcastAt: new Date(0), amount: '1 USDC', destination: LOCKING }, deps);
    expect(run.ok).toBe(false);
  });
});
