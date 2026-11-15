import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ElectrumChain, parseUtxos, scriptHash, type ElectrumLike, type Server } from './electrum.js';
import { BroadcastError, ChainUnavailableError } from './types.js';

const fakeClients = (behaviour: Record<string, (method: string) => unknown>) => {
  const calls: string[] = [];
  const createClient = (s: Server): ElectrumLike => ({
    connect: async () => {
      if (behaviour[s.host] === undefined) throw new Error(`cannot reach ${s.host}`);
    },
    request: async (method) => {
      calls.push(`${s.host} ${method}`);
      const r = behaviour[s.host]!(method);
      if (r instanceof Error && r.message === 'throw') throw r;
      return r;
    },
    disconnect: async () => true,
  });
  return { calls, createClient };
};

describe('electrum helpers', () => {
  it('hashes a locking bytecode the way Electrum expects (reversed sha256)', () => {
    const lock = '76a914' + '11'.repeat(20) + '88ac';
    const expected = Buffer.from(createHash('sha256').update(Buffer.from(lock, 'hex')).digest()).reverse().toString('hex');
    expect(scriptHash(lock)).toBe(expected);
  });

  it('parses listunspent with token data into exact amounts', () => {
    const [u] = parseUtxos([
      { tx_hash: 'aa'.repeat(32), tx_pos: 11n, value: 25199227142n, height: 0, token_data: { amount: '5237019', category: 'AB'.repeat(32) } },
    ]);
    expect(u).toEqual({ txid: 'aa'.repeat(32), vout: 11, sats: 25199227142n, height: 0, token: { category: 'ab'.repeat(32), amount: 5237019n } });
  });

  it('tells a spent-input rejection apart from other rejections', () => {
    expect(new BroadcastError('bad-txns-inputs-missingorspent').staleInputs).toBe(true);
    expect(new BroadcastError('the transaction was rejected by network rules.\n\nmissing inputs').staleInputs).toBe(true);
    expect(new BroadcastError('TX decode failed').staleInputs).toBe(false);
  });
});

describe('ElectrumChain failover', () => {
  const urls = ['wss://a.example:50004', 'wss://b.example:50004', 'wss://c.example:50004'];

  it('moves to the next server when one cannot be reached or errors', async () => {
    const { calls, createClient } = fakeClients({
      'b.example': () => new Error('throw'),
      'c.example': (m) => (m === 'blockchain.headers.get_tip' ? { height: 977359n } : []),
    });
    const chain = new ElectrumChain(urls, { createClient });
    expect(await chain.tipHeight()).toBe(977359);
    expect(chain.current).toBe('wss://c.example:50004');
    expect(calls).toEqual(['b.example blockchain.headers.get_tip', 'c.example blockchain.headers.get_tip']);
  });

  it('gives up with ChainUnavailableError after every server failed once', async () => {
    const { createClient } = fakeClients({});
    const chain = new ElectrumChain(urls, { createClient });
    await expect(chain.listUnspent('6a')).rejects.toBeInstanceOf(ChainUnavailableError);
  });

  it('returns a node rejection as BroadcastError instead of failing over', async () => {
    const { calls, createClient } = fakeClients({ 'a.example': () => new Error('bad-txns-inputs-missingorspent') });
    const chain = new ElectrumChain(urls, { createClient });
    const err = await chain.broadcast('00').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BroadcastError);
    expect((err as BroadcastError).staleInputs).toBe(true);
    expect(calls).toHaveLength(1);
  });
});

describe('ElectrumChain watch', () => {
  const lock = '76a914' + '22'.repeat(20) + '88ac';

  const subscribingClients = () => {
    const subs: string[] = [];
    const listeners = new Map<string, (n: { method: string; params?: unknown }) => void>();
    const createClient = (s: Server): ElectrumLike => ({
      connect: async () => {
        if (s.host === 'down.example') throw new Error('cannot reach');
      },
      request: async (method) => {
        if (s.host === 'bad.example') throw new Error('broken');
        return method === 'blockchain.headers.get_tip' ? { height: 1n } : [];
      },
      disconnect: async () => true,
      subscribe: async (method, sh) => {
        subs.push(`${s.host} ${method} ${String(sh)}`);
      },
      unsubscribe: async (method, sh) => {
        subs.push(`${s.host} un ${String(sh)}`);
      },
      on: (_event, listener) => listeners.set(s.host, listener),
    });
    return { subs, listeners, createClient };
  };

  it('subscribes the script hash, routes notifications to the listener and unsubscribes when the last one leaves', async () => {
    const { subs, listeners, createClient } = subscribingClients();
    const chain = new ElectrumChain(['wss://a.example:50004'], { createClient });
    let seen = 0;
    const off = chain.watch(lock, () => seen++);
    await chain.tipHeight();
    await new Promise((r) => setTimeout(r, 0));
    expect(subs).toEqual([`a.example blockchain.scripthash.subscribe ${scriptHash(lock)}`]);
    listeners.get('a.example')!({ method: 'blockchain.scripthash.subscribe', params: [scriptHash(lock), 'status'] });
    listeners.get('a.example')!({ method: 'blockchain.scripthash.subscribe', params: ['00'.repeat(32), 'status'] });
    expect(seen).toBe(1);
    off();
    expect(subs.at(-1)).toBe(`a.example un ${scriptHash(lock)}`);
  });

  it('subscribes again on the next server after a failover', async () => {
    const { subs, createClient } = subscribingClients();
    const chain = new ElectrumChain(['wss://bad.example:50004', 'wss://b.example:50004'], { createClient });
    chain.watch(lock, () => undefined);
    await chain.tipHeight();
    await new Promise((r) => setTimeout(r, 0));
    expect(subs).toContain(`b.example blockchain.scripthash.subscribe ${scriptHash(lock)}`);
  });
});
