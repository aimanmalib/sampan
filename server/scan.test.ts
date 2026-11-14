import { describe, expect, it } from 'vitest';
import { parseAddress } from '../core/address.js';
import { blankAddresses, userAddress, userLockHex } from '../tests/helpers/wallet.js';
import { FakeChain } from './chain/fake.js';
import { ScanInputError, Scanner } from './scan.js';

const lockOf = (a: string): string => (parseAddress(a, 'bitcoincash') as { lockingHex: string }).lockingHex;
const scanner = (chain: FakeChain, now = () => 0) =>
  new Scanner({ chain, prefix: 'bitcoincash', gapLimit: 20, maxAddresses: 60, cacheSeconds: 600, now });

describe('Scanner', () => {
  it('asks for more addresses until 20 unused ones follow the last used one', async () => {
    const chain = new FakeChain();
    const list = blankAddresses(20);
    chain.add(lockOf(list[5]!), { txid: 'aa'.repeat(32), vout: 0, sats: 10_000n, height: 1 });
    const res = await scanner(chain).scan({ paths: { receive: list, change: blankAddresses(20, 1) } });
    expect(res.paths.receive!.more).toBe(true); // only 14 unused after index 5
    expect(res.paths.receive!.addresses[5]!.utxos[0]!.sats).toBe(10_000n);
    expect(res.paths.change!.more).toBe(false); // 20 unused in a row
  });

  it('counts an address with history but no coins as used (funds are not assumed at receive/0)', async () => {
    const chain = new FakeChain();
    const list = blankAddresses(25);
    chain.add(lockOf(list[3]!), { txid: 'bb'.repeat(32), vout: 0, sats: 1n, height: 1 });
    const res = await scanner(chain).scan({ paths: { defi: list } });
    expect(res.paths.defi!.addresses[3]!.used).toBe(true);
    expect(res.paths.defi!.more).toBe(false); // 21 unused after index 3
  });

  it('keeps results in memory for the cache time and forgets them on request', async () => {
    const chain = new FakeChain();
    let now = 0;
    const s = scanner(chain, () => now);
    await s.scan({ paths: { receive: [userAddress] } });
    chain.add(userLockHex, { txid: 'cc'.repeat(32), vout: 0, sats: 5n, height: 0 });
    now = 599_000;
    expect((await s.scan({ paths: { receive: [userAddress] } })).paths.receive!.addresses[0]!.used).toBe(false);
    s.forget([userLockHex]);
    expect((await s.scan({ paths: { receive: [userAddress] } })).paths.receive!.addresses[0]!.used).toBe(true);
  });

  it('rejects too many addresses, none, or an address for another network', async () => {
    const s = scanner(new FakeChain());
    await expect(s.scan({ paths: { receive: blankAddresses(61) } })).rejects.toBeInstanceOf(ScanInputError);
    await expect(s.scan({ paths: {} })).rejects.toBeInstanceOf(ScanInputError);
    await expect(s.scan({ paths: { receive: ['bchtest:qqdrxemwdc9mnhvw4mpls2gk7s8g8p5sy5n8jn26ge'] } })).rejects.toThrow(/bitcoincash/);
  });

  it('calls the first-scan hook with receive/0 only on the first batch', async () => {
    const seen: string[] = [];
    const s = new Scanner({ chain: new FakeChain(), prefix: 'bitcoincash', gapLimit: 20, maxAddresses: 60, cacheSeconds: 1, beforeFirstScan: (l) => seen.push(l) });
    const list = blankAddresses(2);
    await s.scan({ paths: { receive: list } });
    await s.scan({ paths: { receive: blankAddresses(2, 9) }, start: 20 });
    expect(seen).toEqual([lockOf(list[0]!)]);
  });
});
