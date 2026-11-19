import { binToHex, encodeTransaction, hashTransaction, type Input } from '@bitauth/libauth';
import { describe, expect, it } from 'vitest';
import { checkTransaction, type Expectation } from '../core/check.js';
import { normalizeConfig, type SampanConfig } from '../core/config.js';
import { verifyTransaction } from '../core/tx/verify.js';
import shipped from '../config/sampan.json' with { type: 'json' };
import { PUSD, testKey } from '../tests/helpers/pools.js';
import { tokenAddressOf } from '../core/address.js';
import { otherLockHex, userAddress, userLockHex, userTokenAddress } from '../tests/helpers/wallet.js';
import { signP2pkhInputs } from '../core/tx/sign.js';
import { expectationOf } from './api/swap.js';
import { PoolDirectory } from './indexer.js';
import { fakeNetwork } from './services.js';
import { SwapService } from './swap.js';

const FIXTURE = new URL('../tests/fixtures/cauldron-pusd-pools.json', import.meta.url).pathname;
const config = normalizeConfig(shipped as unknown as SampanConfig);

const setup = (funded = true) => {
  const net = fakeNetwork(config, FIXTURE);
  if (funded) net.fund(userLockHex);
  const pools = new PoolDirectory({ indexers: ['https://i.example'], cacheSeconds: 5, chain: net.chain, fetchActive: net.fetchActive });
  return { ...net, swaps: new SwapService({ config, chain: net.chain, pools, prefix: 'bitcoincash' }) };
};

const outpoint = (i: Input): string => `${binToHex(i.outpointTransactionHash)}:${i.outpointIndex}`;

const wallet = [
  { address: userAddress, path: 'receive/0' },
  { address: userTokenAddress, path: 'receive/0' },
];

/** The page's Expectation, rebuilt from the wire form the API returns. */
const toExpectation = (wire: ReturnType<typeof expectationOf>): Expectation => {
  const w = wire as {
    userLockingBytecodes: string[];
    inputPaths: Expectation['inputPaths'];
    poolOwnerPkhs: string[];
    spend: { sats: string; tokens: Record<string, string> };
    feeCapSats: string;
    receive: { category: string; min: string };
  };
  return {
    userLockingBytecodes: w.userLockingBytecodes,
    inputPaths: w.inputPaths,
    poolOwnerPkhs: w.poolOwnerPkhs,
    spend: { sats: BigInt(w.spend.sats), tokens: Object.fromEntries(Object.entries(w.spend.tokens).map(([k, v]) => [k, BigInt(v)])) },
    feeCapSats: BigInt(w.feeCapSats),
    receive: { category: w.receive.category, min: BigInt(w.receive.min) },
  };
};

describe('SwapService.quote', () => {
  it('quotes a buy with a slippage minimum below the pool answer', async () => {
    const q = await setup().swaps.quote({ token: 'PUSD', side: 'buy', amount: 1_000_000n });
    expect(q.category).toBe(PUSD);
    expect(q.demand).toBeGreaterThan(0n);
    expect(q.minReceive).toBe((q.demand * BigInt(10_000 - config.cauldron.slippageBps)) / 10_000n);
  });

  it('enforces the local minimum and the USD maximum from config', async () => {
    const { swaps } = setup();
    await expect(swaps.quote({ token: 'PUSD', side: 'buy', amount: BigInt(config.limits.localMinSats - 1) })).rejects.toMatchObject({ code: 'below_min' });
    const tooMany = BigInt(Math.round((config.limits.maxUsd + 1) * 100));
    await expect(swaps.quote({ token: 'PUSD', side: 'sell', amount: tooMany })).rejects.toMatchObject({ code: 'above_max' });
  });

  it('refuses a token that is not offered (MUSD behind its flag)', async () => {
    await expect(setup().swaps.quote({ token: 'MUSD', side: 'buy', amount: 100_000n })).rejects.toMatchObject({ code: 'bad_request' });
  });
});

describe('MUSD behind features.musd (MUSa)', () => {
  const musdOn = { ...config, features: { ...config.features, musd: true } };
  const setupOn = () => {
    const net = fakeNetwork(musdOn, FIXTURE);
    net.fund(userLockHex);
    const pools = new PoolDirectory({ indexers: ['https://i.example'], cacheSeconds: 5, chain: net.chain, fetchActive: net.fetchActive });
    return new SwapService({ config: musdOn, chain: net.chain, pools, prefix: 'bitcoincash' });
  };

  it('quotes and builds MUSD in its own category, and leaves the PUSD quote as it was', async () => {
    const swaps = setupOn();
    const musd = musdOn.tokens.MUSD!.category.toLowerCase();
    const q = await swaps.quote({ token: 'MUSD', side: 'buy', amount: 300_000n });
    expect(q.category.toLowerCase()).toBe(musd);
    const b = await swaps.build({ token: 'MUSD', side: 'buy', amount: 300_000n, minReceive: q.minReceive, addresses: wallet, payoutAddress: userTokenAddress, changeAddress: userAddress });
    const paid = b.built.transaction.outputs.filter((o) => o.token && binToHex(o.token.category) === musd);
    expect(paid.length).toBeGreaterThan(0);
    expect(b.built.transaction.outputs.some((o) => o.token && binToHex(o.token.category) === PUSD.toLowerCase())).toBe(false);
    const pusdOn = await swaps.quote({ token: 'PUSD', side: 'buy', amount: 300_000n });
    const pusdOff = await setup().swaps.quote({ token: 'PUSD', side: 'buy', amount: 300_000n });
    expect(pusdOn.demand).toBe(pusdOff.demand);
  });
});

describe('SwapService.build', () => {
  for (const side of ['buy', 'sell'] as const) {
    it(`${side}: the page's checkTransaction accepts it and the signed transaction passes the VM`, async () => {
      const { swaps } = setup();
      const amount = side === 'buy' ? 300_000n : 500n;
      const q = await swaps.quote({ token: 'PUSD', side, amount });
      const b = await swaps.build({ token: 'PUSD', side, amount, minReceive: q.minReceive, addresses: wallet, payoutAddress: side === 'buy' ? userTokenAddress : userAddress, changeAddress: side === 'buy' ? userAddress : userTokenAddress });
      const { transaction, sourceOutputs, userInputIndexes } = b.built;
      expect(checkTransaction(transaction, sourceOutputs, toExpectation(expectationOf(b, config.fees.capSats)))).toEqual({ ok: true });
      expect(b.inputPaths.every((p) => p.path === 'receive/0')).toBe(true);
      const signed = signP2pkhInputs(transaction, sourceOutputs, userInputIndexes, testKey);
      expect(verifyTransaction(signed, sourceOutputs)).toEqual({ ok: true });
    });
  }

  it('stops with price_moved when fresh pools give less than the quoted minimum', async () => {
    const { swaps } = setup();
    const q = await swaps.quote({ token: 'PUSD', side: 'buy', amount: 300_000n });
    await expect(
      swaps.build({ token: 'PUSD', side: 'buy', amount: 300_000n, minReceive: q.demand + 1n, addresses: wallet, payoutAddress: userTokenAddress, changeAddress: userAddress }),
    ).rejects.toMatchObject({ code: 'price_moved' });
  });

  it('sends bought tokens only to a token address and only to the wallet itself', async () => {
    const { swaps } = setup();
    const base = { token: 'PUSD', side: 'buy' as const, amount: 300_000n, minReceive: 1n, addresses: wallet, changeAddress: userAddress };
    await expect(swaps.build({ ...base, payoutAddress: userAddress })).rejects.toThrow(/token address/);
    await expect(swaps.build({ ...base, payoutAddress: tokenAddressOf(otherLockHex, 'bitcoincash') })).rejects.toThrow(/wallet addresses/);
  });

  it('never spends a coin that carries an NFT or another token', async () => {
    const net = setup(false);
    net.chain.add(userLockHex, { txid: '11'.repeat(32), vout: 0, sats: 5_000_000n, height: 1, token: { category: PUSD, amount: 1n, nft: { capability: 'none', commitment: '' } } });
    net.chain.add(userLockHex, { txid: '22'.repeat(32), vout: 0, sats: 5_000_000n, height: 1, token: { category: 'ee'.repeat(32), amount: 9n } });
    await expect(
      net.swaps.build({ token: 'PUSD', side: 'buy', amount: 300_000n, minReceive: 1n, addresses: wallet, payoutAddress: userTokenAddress, changeAddress: userAddress }),
    ).rejects.toMatchObject({ code: 'not_enough_funds' });
  });

  it('after a swap is broadcast, the next build spends the successor pool UTXOs, not the spent ones', async () => {
    const { swaps, chain } = setup();
    const req = { token: 'PUSD', side: 'buy' as const, amount: 300_000n, minReceive: 1n, addresses: wallet, payoutAddress: userTokenAddress, changeAddress: userAddress };
    const first = await swaps.build(req);
    const signed = signP2pkhInputs(first.built.transaction, first.built.sourceOutputs, first.built.userInputIndexes, testKey);
    await chain.broadcast(binToHex(encodeTransaction(signed)));
    const spent = new Set(first.built.transaction.inputs.map(outpoint));
    const second = await swaps.build(req);
    expect(second.built.transaction.inputs.map(outpoint).filter((o) => spent.has(o))).toEqual([]);
    const firstTxid = hashTransaction(encodeTransaction(signed));
    expect(second.built.transaction.inputs.some((i) => binToHex(i.outpointTransactionHash) === firstTxid)).toBe(true);
  });
});
