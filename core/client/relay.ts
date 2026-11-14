// Source outputs in the WizardConnect relay format (hex bytes, "<bigint: Xn>" amounts) and back. The page
// writes them into sign requests; the headless test wallet reads them.
import { sourceOutputToRelay } from '@wizardconnect/core/hdwalletv1-serialize';
import { outputFromWire, txFromHex, type WireOutput } from '../wire.js';
import type { SignRequest } from './session.js';

/** Each spent output merged with the input that spends it, as hdwalletv1 sign requests carry them. */
export function relaySourceOutputs(request: Pick<SignRequest, 'tx' | 'sourceOutputs'>): unknown[] {
  const tx = txFromHex(request.tx);
  return tx.inputs.map((input, i) => {
    const wire = request.sourceOutputs[i];
    if (!wire) throw new Error(`no source output for input ${i}`);
    return sourceOutputToRelay({ ...input, ...outputFromWire(wire) });
  });
}

const HEX = /^(?:[0-9a-fA-F]{2})*$/;
const bigintOf = (v: unknown): string => {
  const m = typeof v === 'string' ? /^<bigint: ([0-9]+)n>$/.exec(v) : null;
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return String(v);
  if (!m?.[1]) throw new Error(`not a relay amount: ${String(v)}`);
  return m[1];
};
const hexOf = (v: unknown): string => {
  if (typeof v !== 'string' || !HEX.test(v)) throw new Error('not hex');
  return v.toLowerCase();
};

/** Relay source outputs -> wire outputs. NFTs are refused: no Sampan flow signs for one. */
export function parseRelaySourceOutputs(list: unknown): WireOutput[] {
  if (!Array.isArray(list)) throw new Error('sourceOutputs is not a list');
  return list.map((raw) => {
    const o = raw as Record<string, unknown>;
    const token = o.token as Record<string, unknown> | undefined;
    if (token?.nft) throw new Error('a source output carries an NFT');
    return {
      lockingBytecode: hexOf(o.lockingBytecode),
      valueSatoshis: bigintOf(o.valueSatoshis),
      ...(token ? { token: { category: hexOf(token.category), amount: bigintOf(token.amount) } } : {}),
    };
  });
}
