// Headless test wallet: pair with a WizardConnect link and sign what the policy approves.
//   npm run test-wallet -- <wiz://link> <intent.json> [--timeout-seconds 300] [--signatures 1]
// Reads SAMPAN_TEST_BCH_PHRASE from the env file (SAMPAN_ENV_FILE, default .env), the budget from
// state/budget.json and the spending record from state/test-ledger.jsonl. The intent file is read again for
// every request, so a measuring script can write what the page showed just before it asks. Exits after the
// given number of signatures, or after the first refusal.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { WalletConnectionManager } from '@wizardconnect/wallet';
import { hdKeysFromPhrase } from '../../core/client/session.js';
import { deriveAddress, WALLET_PATHS } from '../../core/wallet.js';
import { askFromRequest, testWalletAdapter } from './adapter.js';
import { SECRET_KEYS, parseEnv } from './keys.js';
import { record, spentOn } from './ledger.js';
import { review, type Budget, type Intent } from './policy.js';

const OWN_ADDRESSES_PER_PATH = 40;

function main(): void {
  const [uri, intentFile] = process.argv.slice(2);
  if (!uri?.startsWith('wiz') || !intentFile) throw new Error('usage: connect.ts <wiz://link> <intent.json>');
  const flag = (name: string, fallback: number): number => {
    const i = process.argv.indexOf(name);
    return i > 0 ? Number(process.argv[i + 1]) : fallback;
  };
  const timeoutSeconds = flag('--timeout-seconds', 300);
  let signaturesLeft = flag('--signatures', 1);
  const env = parseEnv(readFileSync(path.resolve(process.env.SAMPAN_ENV_FILE ?? '.env'), 'utf8'));
  const phrase = env.get(SECRET_KEYS.bchMainnet);
  if (!phrase) throw new Error(`${SECRET_KEYS.bchMainnet} is missing from the env file`);
  const keys = hdKeysFromPhrase(phrase);
  const config = JSON.parse(readFileSync('config/sampan.json', 'utf8')) as { fees: { capSats: number } };
  const budget = JSON.parse(readFileSync('state/budget.json', 'utf8')) as Budget;
  const intent = (): Intent => JSON.parse(readFileSync(intentFile, 'utf8')) as Intent;
  const ledger = 'state/test-ledger.jsonl';
  const ownLocks = WALLET_PATHS.flatMap((p) =>
    Array.from({ length: OWN_ADDRESSES_PER_PATH }, (_, i) => deriveAddress(keys.publicKey(p, i), p, i, 'bitcoincash').lockingHex),
  );
  const decision = {
    approve: (ask: Parameters<typeof review>[0]) =>
      review(ask, { ownLocks, intent: intent(), budget, spentTodayUsd: spentOn(ledger, new Date().toISOString().slice(0, 10)), feeCapSats: BigInt(config.fees.capSats) }),
    signed: (ask: { prompt: string }) => record(ledger, { utc: new Date().toISOString(), usd: intent().usd, prompt: ask.prompt }),
  };
  const adapter = testWalletAdapter(keys, decision);
  const manager = new WalletConnectionManager(adapter);
  const timer = setTimeout(() => {
    console.error('timed out waiting for a sign request');
    manager.disconnectAll();
    process.exit(2);
  }, timeoutSeconds * 1000);
  manager.on('pendingSignRequest', ({ connectionId, request }) => {
    void adapter
      .signTransaction(request)
      .then(async ({ signedTransaction }) => {
        await manager.sendSignResponse(connectionId, request.sequence, signedTransaction);
        console.log(`signed: ${askFromRequest(request).prompt}`);
        signaturesLeft -= 1;
        if (signaturesLeft > 0) return;
        clearTimeout(timer);
        setTimeout(() => process.exit(0), 2000);
      })
      .catch(async (e: unknown) => {
        const message = e instanceof Error ? e.message : String(e);
        await manager.sendSignError(connectionId, request.sequence, message);
        console.error(message);
        clearTimeout(timer);
        setTimeout(() => process.exit(1), 2000);
      });
  });
  manager.connect(uri);
  console.log('paired; waiting for a sign request');
}

main();
