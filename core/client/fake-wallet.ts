// The wallet the page connects to under SAMPAN_FAKE=1 (e2e and local runs). Its phrase is the public BIP39
// test vector: it never holds real funds and the page only loads this module when the server says it is fake.
import { hdKeysFromPhrase, signWithHdKeys, type WalletSession } from './session.js';

export const FAKE_WALLET_PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

export function fakeWalletSession(name = 'Test wallet'): WalletSession {
  const keys = hdKeysFromPhrase(FAKE_WALLET_PHRASE);
  return { name, publicKey: keys.publicKey, sign: async (request) => signWithHdKeys(keys, request) };
}
