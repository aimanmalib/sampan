// How a measured run is shown: the chain's name, the explorer link of each transaction id and the measured time.
// Shared by the /how proof table and the finished crossing page; names and explorers come from config.
import { SECONDS_UP_TO } from '../../../core/client/measured';
import type { ProofTxid } from '../../../core/proof';
import type { LoadedConfig } from '../config';
import type { useText } from '../i18n';

type T = ReturnType<typeof useText>['t'];

export const shortTxid = (id: string): string => `${id.slice(0, id.startsWith('0x') ? 10 : 8)}…${id.slice(-6)}`;

export function runText(config: LoadedConfig, t: T) {
  // A Runs cell names its chain in lower case (bch, eth, base, …).
  const evmChain = (chain: string) => config.evm.chains.find((c) => c.key.toLowerCase() === chain);
  return {
    chainName: (chain: string): string => (chain === 'bch' ? t('proof.chain.bch') : (evmChain(chain)?.name ?? chain.toUpperCase())),
    href: (x: ProofTxid): string =>
      x.chain === 'bch' ? config.connect.explorerTxUrl.replace('{txid}', x.id) : `${evmChain(x.chain)?.explorer ?? ''}/tx/${x.id}`,
    time: (s: number | null): string =>
      s === null
        ? t('proof.none')
        : s < SECONDS_UP_TO
          ? t('measured.seconds', { n: s.toFixed(1) })
          : t('measured.minutes', { n: String(Math.round(s / 60)) }),
  };
}
