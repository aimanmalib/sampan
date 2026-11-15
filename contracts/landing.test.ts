// Landing contract tests on CashScript's MockNetworkProvider (no network). Every transaction is evaluated by the
// BCH VM. The "pool" here is a plain P2PKH coin holding tokens: the contract only cares about output 0.
import { binToHex, hexToBin, secp256k1, sha256, encodeLockingBytecodeP2pkh, hash160 } from '@bitauth/libauth';
import { Contract, MockNetworkProvider, SignatureTemplate, TransactionBuilder, randomUtxo, type SpendableUtxo } from 'cashscript';
import { beforeEach, describe, expect, it } from 'vitest';
import { categoryToScriptOrder, landingAddress, landingLockingHex, landingRedeemScript, minTokensFor, type LandingParams } from '../core/landing.js';
import artifact from './landing.json' with { type: 'json' };

const keyOf = (seed: string) => {
  const priv = sha256.hash(new TextEncoder().encode(seed));
  const pub = secp256k1.derivePublicKeyCompressed(priv);
  if (typeof pub === 'string') throw new Error(pub);
  return { priv, lock: encodeLockingBytecodeP2pkh(hash160(pub)) };
};

const OWNER = keyOf('sampan landing owner');
const POOL = keyOf('sampan landing stand-in pool');
const STRANGER = keyOf('sampan landing stranger');
const CATEGORY = '2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544';
const OTHER_CATEGORY = 'b38a33f750f84c5c169a6f23cb873e6e79605021585d4f3408789689ed87f366';
const RETURN_AFTER = 6;
const COIN = 100_000n;
const PARAMS: LandingParams = { ownerLockHex: binToHex(OWNER.lock), category: CATEGORY, rateNum: 50_000n, rateDen: 100_000_000n, returnAfter: RETURN_AFTER };
const MIN_TOKENS = minTokensFor(PARAMS, COIN); // 50 base units for 100,000 sats
const DUST = 1000n;

const contractFor = (p: LandingParams, provider: MockNetworkProvider, categoryBytes = categoryToScriptOrder(p.category)) =>
  new Contract(artifact, [hexToBin(p.ownerLockHex), categoryBytes, p.rateNum, p.rateDen, BigInt(p.returnAfter)], { provider, contractType: 'p2sh20' });

let provider: MockNetworkProvider;
let landing: Contract;
let coin: SpendableUtxo;
let pool: SpendableUtxo;
const poolSigner = new SignatureTemplate(POOL.priv);

beforeEach(() => {
  provider = new MockNetworkProvider();
  landing = contractFor(PARAMS, provider);
  coin = provider.addUtxo(landing.address, randomUtxo({ satoshis: COIN }));
  pool = provider.addUtxo(binToHex(POOL.lock), randomUtxo({ satoshis: 10_000_000n, token: { category: CATEGORY, amount: 1_000_000n } }));
});

interface ConvertShape {
  tokens?: bigint;
  ownerLock?: Uint8Array;
  category?: string;
  extraOutput?: boolean;
  landingSecond?: boolean;
}

/** convert: [landing, pool] -> [tokens to owner, pool change]. The pool keeps the BCH minus fee and dust. */
const convertTx = (s: ConvertShape = {}) => {
  const tokens = s.tokens ?? MIN_TOKENS;
  const category = s.category ?? CATEGORY;
  const tb = new TransactionBuilder({ provider });
  if (s.landingSecond) tb.addInput(pool, poolSigner.unlockP2PKH()).addInput(coin, landing.unlock.convert!());
  else tb.addInput(coin, landing.unlock.convert!()).addInput(pool, poolSigner.unlockP2PKH());
  const poolTokens = s.category && s.category !== CATEGORY ? 1_000_000n : 1_000_000n - tokens;
  if (s.category && s.category !== CATEGORY) {
    const other = provider.addUtxo(binToHex(STRANGER.lock), randomUtxo({ satoshis: 2_000n, token: { category, amount: tokens } }));
    tb.addInput(other, new SignatureTemplate(STRANGER.priv).unlockP2PKH());
  }
  tb.addOutput({ to: s.ownerLock ?? OWNER.lock, amount: DUST, token: { category, amount: tokens } });
  tb.addOutput({ to: POOL.lock, amount: 10_000_000n + COIN - DUST - 2_000n, token: { category: CATEGORY, amount: poolTokens } });
  if (s.category && s.category !== CATEGORY) tb.addOutput({ to: STRANGER.lock, amount: 1_000n });
  if (s.extraOutput) tb.addOutput({ to: STRANGER.lock, amount: 1_000n });
  return tb;
};

interface GiveBackShape {
  sequence?: number;
  value?: bigint;
  to?: Uint8Array;
  token?: boolean;
  twoOutputs?: boolean;
}

const giveBackTx = (s: GiveBackShape = {}) => {
  const tb = new TransactionBuilder({ provider });
  tb.addInput(coin, landing.unlock.giveBack!(), { sequence: s.sequence ?? RETURN_AFTER });
  if (s.token) {
    // A coin at output index 0 may create a new token category (genesis), so a single input can still
    // produce a token output: only the contract's "no token" rule stops it.
    tb.addOutput({ to: OWNER.lock, amount: COIN - 1000n, token: { category: coin.txid, amount: 1n } });
    return tb;
  }
  const value = s.value ?? COIN - 500n;
  if (s.twoOutputs) {
    tb.addOutput({ to: OWNER.lock, amount: value - 1_000n });
    tb.addOutput({ to: OWNER.lock, amount: 1_000n - 0n });
  } else {
    tb.addOutput({ to: s.to ?? OWNER.lock, amount: value });
  }
  return tb;
};

describe('landing contract: address', () => {
  it('core computes the same redeem script and P2SH20 address as CashScript', () => {
    expect(binToHex(landingRedeemScript(PARAMS))).toBe(landing.bytecode);
    expect(landingAddress(PARAMS, 'bchtest')).toBe(landing.address); // the mock provider is chipnet
    expect(landing.address).toMatch(/^bchtest:p/);
    expect(landingLockingHex(PARAMS)).toMatch(/^a914[0-9a-f]{40}87$/);
  });

  it('a different rate gives a different address', () => {
    expect(landingAddress({ ...PARAMS, rateNum: PARAMS.rateNum + 1n }, 'bitcoincash')).not.toBe(landing.address);
  });
});

describe('landing contract: convert', () => {
  it('passes at the exact minimum', async () => {
    await expect(convertTx().send()).resolves.toBeDefined();
  });

  it('fails one base unit below the minimum', async () => {
    await expect(convertTx({ tokens: MIN_TOKENS - 1n }).send()).rejects.toThrow(/tokenAmount \* rateDen >= tx\.inputs\[0\]\.value \* rateNum/);
  });

  it('fails when output 0 pays a different locking bytecode', async () => {
    await expect(convertTx({ ownerLock: STRANGER.lock }).send()).rejects.toThrow(/tx\.outputs\[0\]\.lockingBytecode == ownerLock/);
  });

  it('fails when output 0 carries another token category', async () => {
    await expect(convertTx({ category: OTHER_CATEGORY }).send()).rejects.toThrow(/tx\.outputs\[0\]\.tokenCategory == tokenCategory/);
  });

  it('fails with an extra output', async () => {
    await expect(convertTx({ extraOutput: true }).send()).rejects.toThrow(/tx\.outputs\.length == tx\.inputs\.length/);
  });

  it('fails when the landing coin is not input 0', async () => {
    await expect(convertTx({ landingSecond: true }).send()).rejects.toThrow(/this\.activeInputIndex == 0/);
  });

  it('needs the category in transaction byte order, not the explorer order', async () => {
    const wrong = contractFor(PARAMS, provider, hexToBin(CATEGORY));
    expect(wrong.address).not.toBe(landing.address);
    coin = provider.addUtxo(wrong.address, randomUtxo({ satoshis: COIN }));
    const tb = new TransactionBuilder({ provider })
      .addInput(coin, wrong.unlock.convert!())
      .addInput(pool, poolSigner.unlockP2PKH())
      .addOutput({ to: OWNER.lock, amount: DUST, token: { category: CATEGORY, amount: MIN_TOKENS } })
      .addOutput({ to: POOL.lock, amount: 10_000_000n + COIN - DUST - 2_000n, token: { category: CATEGORY, amount: 1_000_000n - MIN_TOKENS } });
    await expect(tb.send()).rejects.toThrow(/tx\.outputs\[0\]\.tokenCategory == tokenCategory/);
  });

  it('pays a P2SH owner by its full 23-byte locking bytecode', async () => {
    const p2shOwner = `a914${'11'.repeat(20)}87`;
    const params = { ...PARAMS, ownerLockHex: p2shOwner };
    landing = contractFor(params, provider);
    expect(landing.address).toBe(landingAddress(params, 'bchtest'));
    coin = provider.addUtxo(landing.address, randomUtxo({ satoshis: COIN }));
    await expect(convertTx({ ownerLock: hexToBin(p2shOwner) }).send()).resolves.toBeDefined();
  });

  it('settles several coins at the same address one after another', async () => {
    const second = provider.addUtxo(landing.address, randomUtxo({ satoshis: COIN }));
    await expect(convertTx().send()).resolves.toBeDefined();
    coin = second;
    pool = (await provider.getUtxosForLockingBytecode(POOL.lock)).find((u) => u.token?.category === CATEGORY)!;
    const tb = new TransactionBuilder({ provider })
      .addInput(coin, landing.unlock.convert!())
      .addInput(pool, poolSigner.unlockP2PKH())
      .addOutput({ to: OWNER.lock, amount: DUST, token: { category: CATEGORY, amount: MIN_TOKENS } })
      .addOutput({ to: POOL.lock, amount: pool.satoshis + COIN - DUST - 2_000n, token: { category: CATEGORY, amount: pool.token!.amount - MIN_TOKENS } });
    await expect(tb.send()).resolves.toBeDefined();
    expect(await provider.getUtxos(landing.address)).toHaveLength(0);
  });
});

describe('landing contract: giveBack', () => {
  it('fails before the coin is returnAfter blocks old', async () => {
    await expect(giveBackTx({ sequence: RETURN_AFTER - 1 }).send()).rejects.toThrow(/this\.age >= returnAfter/);
  });

  it('fails with the default final sequence (relative lock disabled)', async () => {
    await expect(giveBackTx({ sequence: 0xfffffffe }).send()).rejects.toThrow(/this\.age >= returnAfter/);
  });

  it('passes once the coin is old enough', async () => {
    await expect(giveBackTx().send()).resolves.toBeDefined();
  });

  it('passes with exactly 1000 sats kept as fee', async () => {
    await expect(giveBackTx({ value: COIN - 1000n }).send()).resolves.toBeDefined();
  });

  it('fails with two outputs', async () => {
    await expect(giveBackTx({ twoOutputs: true }).send()).rejects.toThrow(/tx\.outputs\.length == 1\)/);
  });

  it('fails when the owner gets less than the input minus 1000', async () => {
    await expect(giveBackTx({ value: COIN - 1001n }).send()).rejects.toThrow(/tx\.outputs\[0\]\.value >= tx\.inputs\[0\]\.value - 1000/);
  });

  it('fails to another address', async () => {
    await expect(giveBackTx({ to: STRANGER.lock }).send()).rejects.toThrow(/tx\.outputs\[0\]\.lockingBytecode == ownerLock/);
  });

  it('fails when the output carries a token', async () => {
    coin = provider.addUtxo(landing.address, randomUtxo({ satoshis: COIN, vout: 0 }));
    await expect(giveBackTx({ token: true }).send()).rejects.toThrow(/tx\.outputs\[0\]\.tokenCategory == 0x/);
  });
});
