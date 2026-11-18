import { parseTransaction, recoverTransactionAddress, type Hex, type TransactionSerialized } from 'viem';
import { privateKeyToAddress } from 'viem/accounts';
import { describe, expect, it } from 'vitest';
import { jsonRpcOver, keyProvider, type JsonRpc } from '../tools/measure/evm-key-provider.js';

// A throwaway key made for this test only; it holds nothing on any chain.
const KEY = `0x${'11'.repeat(32)}` as Hex;
const CHAIN = { id: 1, name: 'Ethereum', native: { name: 'Ether', symbol: 'ETH' } };
const TO = '0x2222222222222222222222222222222222222222' as const;

function fakeChain(): { rpc: JsonRpc; sent: string[]; asked: string[] } {
  const sent: string[] = [];
  const asked: string[] = [];
  const rpc: JsonRpc = async (method, params) => {
    asked.push(method);
    switch (method) {
      case 'eth_chainId':
        return '0x1';
      case 'eth_getTransactionCount':
        return '0x7';
      case 'eth_estimateGas':
        return '0xb411';
      case 'eth_maxPriorityFeePerGas':
        return '0x3b9aca00';
      case 'eth_gasPrice':
        return '0x77359400';
      case 'eth_getBlockByNumber':
        return { baseFeePerGas: '0x3b9aca00', number: '0x10', hash: `0x${'ab'.repeat(32)}`, timestamp: '0x1', transactions: [] };
      case 'eth_sendRawTransaction':
        sent.push(params[0] as string);
        return `0x${'cd'.repeat(32)}`;
      case 'eth_call':
        return '0x';
      default:
        throw new Error(`unexpected ${method}`);
    }
  };
  return { rpc, sent, asked };
}

describe('EIP-1193 provider of the EVM test key', () => {
  it('answers for its one chain and refuses another', async () => {
    const p = keyProvider({ key: KEY, chain: CHAIN, rpc: fakeChain().rpc });
    expect(p.address).toBe(privateKeyToAddress(KEY));
    expect(await p.request({ method: 'eth_chainId' })).toBe('0x1');
    expect(await p.request({ method: 'eth_requestAccounts' })).toEqual([p.address]);
    expect(await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1' }] })).toBeNull();
    await expect(p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x38' }] })).rejects.toMatchObject({ code: 4902 });
  });

  it('signs eth_sendTransaction locally and sends the raw transaction, signed by the key, to the chain', async () => {
    const chain = fakeChain();
    const p = keyProvider({ key: KEY, chain: CHAIN, rpc: chain.rpc });
    const hash = await p.request({ method: 'eth_sendTransaction', params: [{ from: p.address, to: TO, data: '0x095ea7b3' }] });
    expect(hash).toBe(`0x${'cd'.repeat(32)}`);
    expect(chain.sent).toHaveLength(1);
    const raw = chain.sent[0] as TransactionSerialized;
    const tx = parseTransaction(raw);
    expect(tx.to).toBe(TO);
    expect(tx.data).toBe('0x095ea7b3');
    expect(tx.chainId).toBe(1);
    expect(tx.nonce).toBe(7);
    expect(await recoverTransactionAddress({ serializedTransaction: raw })).toBe(p.address);
  });

  it('refuses a transaction that names another sender and passes reads through', async () => {
    const chain = fakeChain();
    const p = keyProvider({ key: KEY, chain: CHAIN, rpc: chain.rpc });
    await expect(p.request({ method: 'eth_sendTransaction', params: [{ from: TO, to: TO }] })).rejects.toThrow(/another sender/);
    expect(chain.sent).toHaveLength(0);
    expect(await p.request({ method: 'eth_call', params: [{ to: TO, data: '0x' }, 'latest'] })).toBe('0x');
  });
});

describe('JSON-RPC over the configured endpoints', () => {
  it('moves on when an endpoint does not answer, and keeps a chain error as the answer', async () => {
    const seen: string[] = [];
    const fetcher = (async (url: string) => {
      seen.push(url);
      if (url === 'https://a') throw new Error('down');
      if (url === 'https://b') return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x5' }));
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: 3, message: 'execution reverted' } }));
    }) as unknown as typeof fetch;
    expect(await jsonRpcOver(['https://a', 'https://b'], fetcher)('eth_blockNumber', [])).toBe('0x5');
    await expect(jsonRpcOver(['https://c', 'https://b'], fetcher)('eth_call', [])).rejects.toMatchObject({ code: 3 });
    expect(seen).toEqual(['https://a', 'https://b', 'https://c']);
    await expect(jsonRpcOver(['https://a'], fetcher)('eth_blockNumber', [])).rejects.toThrow('down');
  });
});
