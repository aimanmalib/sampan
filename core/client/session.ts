// What the page needs from a connected BCH wallet, whatever carries the connection (WizardConnect, or the
// fake wallet of SAMPAN_FAKE=1). Also an HD wallet built from a phrase, used by that fake wallet and by the
// headless test wallet. Pure.
import {
  deriveHdPath,
  deriveHdPrivateNodeChild,
  deriveHdPrivateNodeFromBip39Mnemonic,
  deriveHdPublicNode,
  encodeHdPublicKey,
  secp256k1,
  type HdPrivateNodeValid,
  type Output,
} from '@bitauth/libauth';
import { signP2pkhInputs } from '../tx/sign.js';
import { CHILD_INDEX, splitPath, type WalletPath } from '../wallet.js';
import { outputFromWire, txFromHex, txToHex, type WireOutput } from '../wire.js';

export interface SignRequest {
  /** Unsigned transaction hex, exactly as checked. */
  tx: string;
  sourceOutputs: WireOutput[];
  inputPaths: Array<{ inputIndex: number; path: string }>;
  /** One sentence the wallet shows, e.g. "Swap 0.001 BCH to at least 0.21 PUSD". */
  userPrompt: string;
}

export interface WalletSession {
  /** Name the wallet gave itself, if any. */
  name: string | null;
  publicKey(path: WalletPath, index: number): Uint8Array | undefined;
  /** Returns the signed transaction hex. The wallet must not broadcast it. */
  sign(request: SignRequest): Promise<string>;
}

export interface HdKeys {
  publicKey(path: WalletPath, index: number): Uint8Array;
  privateKey(path: WalletPath, index: number): Uint8Array;
  /** Extended public key of m/44'/145'/0'/<child of path>, as WizardConnect shares it. */
  xpub(path: WalletPath): string;
}

/** BIP44 account m/44'/145'/0' of a BIP39 phrase. */
export function hdKeysFromPhrase(phrase: string): HdKeys {
  const root = deriveHdPrivateNodeFromBip39Mnemonic(phrase.trim());
  const parents = new Map<WalletPath, HdPrivateNodeValid>();
  const cache = new Map<string, Uint8Array>();
  const parentOf = (path: WalletPath): HdPrivateNodeValid => {
    let parent = parents.get(path);
    if (!parent) {
      const node = deriveHdPath(root, `m/44'/145'/0'/${CHILD_INDEX[path]}`);
      if (typeof node === 'string') throw new Error(node);
      parent = node;
      parents.set(path, node);
    }
    return parent;
  };
  const privateKey = (path: WalletPath, index: number): Uint8Array => {
    const key = `${path}/${index}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const parent = parentOf(path);
    const child = deriveHdPrivateNodeChild(parent, index);
    if (typeof child === 'string') throw new Error(child);
    cache.set(key, child.privateKey);
    return child.privateKey;
  };
  return {
    privateKey,
    xpub: (path) => encodeHdPublicKey({ network: 'mainnet', node: deriveHdPublicNode(parentOf(path)) }).hdPublicKey,
    publicKey: (path, index) => {
      const pub = secp256k1.derivePublicKeyCompressed(privateKey(path, index));
      if (typeof pub === 'string') throw new Error(pub);
      return pub;
    },
  };
}

/** Signs every listed input with the key of its path. Inputs not listed keep their unlocking bytecode. */
export function signWithHdKeys(keys: HdKeys, request: SignRequest): string {
  let tx = txFromHex(request.tx);
  const sources: Output[] = request.sourceOutputs.map(outputFromWire);
  for (const p of request.inputPaths) {
    const [path, index] = splitPath(p.path);
    tx = signP2pkhInputs(tx, sources, [p.inputIndex], keys.privateKey(path, index));
  }
  return txToHex(tx);
}
