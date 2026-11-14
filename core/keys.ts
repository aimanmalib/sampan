// Address derivation for the headless test wallets (tools/test-wallet). Pure: no I/O, no network.
// BCH: BIP39 phrase -> BIP44 path -> P2PKH CashAddress. EVM: 32-byte private key -> checksummed address.
import {
  decodeBip39Mnemonic,
  deriveHdPath,
  deriveHdPrivateNodeFromBip39Mnemonic,
  encodeCashAddress,
  generateBip39Mnemonic,
  hash160,
  secp256k1,
} from '@bitauth/libauth';
import { privateKeyToAddress } from 'viem/accounts';

export type BchNetwork = 'mainnet' | 'chipnet';

/** BIP44 receive path for coin type 145 (Bitcoin Cash), first account, first address. */
export const BCH_RECEIVE_PATH = "m/44'/145'/0'/0/0";

const PREFIX: Record<BchNetwork, 'bitcoincash' | 'bchtest'> = { mainnet: 'bitcoincash', chipnet: 'bchtest' };

export const newBip39Phrase = (): string => generateBip39Mnemonic();

export const isValidBip39Phrase = (phrase: string): boolean => typeof decodeBip39Mnemonic(phrase.trim()) !== 'string';

export interface BchKey {
  address: string;
  tokenAddress: string;
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export function deriveBchKey(phrase: string, network: BchNetwork, path: string = BCH_RECEIVE_PATH): BchKey {
  if (!isValidBip39Phrase(phrase)) throw new Error('not a valid BIP39 phrase');
  const root = deriveHdPrivateNodeFromBip39Mnemonic(phrase.trim());
  const node = deriveHdPath(root, path);
  if (typeof node === 'string') throw new Error(`cannot derive ${path}: ${node}`);
  const publicKey = secp256k1.derivePublicKeyCompressed(node.privateKey);
  if (typeof publicKey === 'string') throw new Error(publicKey);
  const payload = hash160(publicKey);
  const prefix = PREFIX[network];
  return {
    address: encodeCashAddress({ prefix, type: 'p2pkh', payload }).address,
    tokenAddress: encodeCashAddress({ prefix, type: 'p2pkhWithTokens', payload }).address,
    publicKey,
    privateKey: node.privateKey,
  };
}

const EVM_KEY = /^0x[0-9a-fA-F]{64}$/;

export const isValidEvmKey = (key: string): key is `0x${string}` => EVM_KEY.test(key);

export function evmAddress(key: string): string {
  if (!isValidEvmKey(key)) throw new Error('EVM key must be 0x followed by 64 hex digits');
  return privateKeyToAddress(key);
}
