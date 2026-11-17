// Gas for a bring-in: the chain's gas price from its public RPC (config evm.chains[].rpc, in the CSP already) and, with
// a wallet connected, whether the router still needs an approval. Units are the measured ones in config.
import { useEffect, useState } from 'react';
import type { Hex } from 'viem';
import type { Gas } from '../../../core/cost';
import { readCall, readResult, toTokenUnits } from '../../../core/evm/calldata';
import type { Eip1193 } from '../../../core/client/in';
import type { EvmChain } from '../../../core/route-assets';

async function gasPrice(rpc: string[]): Promise<bigint | null> {
  for (const url of rpc) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_gasPrice', params: [] }) });
      const body = (await res.json()) as { result?: string };
      if (body.result && /^0x[0-9a-f]+$/i.test(body.result)) return BigInt(body.result);
    } catch {
      // next endpoint
    }
  }
  return null;
}

export interface GasAsk {
  /** False on the fake server: no request leaves for a real RPC; gas then shows as extra. */
  enabled: boolean;
  chain: EvmChain;
  /** USD per whole gas coin, 8 decimals, from the quote; null or absent = unknown. */
  nativeUsdE8: string | null | undefined;
  router: string | undefined;
  amount: bigint | undefined;
  wallet: { address: string; provider: Eip1193 } | null;
  token: { address: string; decimals: number };
}

export function useGas(ask: GasAsk): Gas | undefined {
  const { enabled, chain, nativeUsdE8, router, amount, wallet, token } = ask;
  const [price, setPrice] = useState<{ chain: string; wei: bigint | null } | null>(null);
  const [allowance, setAllowance] = useState<{ key: string; value: bigint } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void gasPrice(chain.rpc).then((wei) => live && setPrice({ chain: chain.key, wei }));
    return () => {
      live = false;
    };
  }, [enabled, chain.key, chain.rpc]);
  const address = wallet?.address;
  const provider = wallet?.provider;
  const key = address && router ? `${chain.key}:${address}:${router}:${token.address}` : null;
  useEffect(() => {
    if (!address || !provider || !router || key === null) return;
    let live = true;
    provider
      .request({ method: 'eth_call', params: [{ from: address, to: token.address, data: readCall.allowance(address, router) }, 'latest'] })
      .then((data) => live && setAllowance({ key, value: readResult.uint('allowance', data as Hex) }))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [key, address, provider, router, token.address]);
  const wei = price?.chain === chain.key ? price.wei : null;
  if (wei === null || !nativeUsdE8 || !/^[0-9]+$/.test(nativeUsdE8)) return undefined;
  // Without a wallet (or before the allowance is read) the approval is counted: the higher of the two.
  const have = allowance?.key === key ? allowance.value : null;
  const approve = have === null || amount === undefined || have < toTokenUnits(amount, token.decimals);
  return { approve, approveUnits: BigInt(chain.gas.approve), depositUnits: BigInt(chain.gas.deposit), priceWei: wei, nativeUsdE8: BigInt(nativeUsdE8) };
}
