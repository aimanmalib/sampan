// The proof line by the front page card (K6P6): one real stablecoin crossing into PUSD, the newest ok one in the Runs
// table of docs/MEASURED.md, picked here (never typed). The amount and the asset come from the row's amount cell
// ("1.6 AVAX.USDC to PUSD …"); the chain's name and explorer come from config on the page. config.ui.heroProof
// "latest-in" draws it, "none" leaves it out (the way back).
import type { Proof, ProofRun, ProofTxid } from './proof.js';

export const HERO_PROOF_KINDS = ['latest-in', 'none'] as const;
export type HeroProofKind = (typeof HERO_PROOF_KINDS)[number];

/** Flows of the Runs table that bring a stablecoin from another chain into PUSD (THORChain and NEAR Intents). */
export const HERO_PROOF_FLOWS: readonly ProofRun['flow'][] = ['in', 'oc-in'];

export interface HeroProof {
  utc: string;
  /** As written in the row: "1.6". */
  amount: string;
  /** The stablecoin: "USDC". */
  symbol: string;
  /** Chain key in lower case, as the Runs cell names it ("avax"). */
  chain: string;
  seconds: number | null;
  /** The BCH transaction (the coins arriving at the landing address). */
  bch: ProofTxid;
  /** The other chain's transaction. */
  evm: ProofTxid;
}

const AMOUNT = /^(\d+(?:\.\d+)?) ([A-Z]+)\.([A-Z]+) to PUSD\b/;

/** The newest ok stablecoin crossing into PUSD with both transactions recorded; null when there is none, or when
 *  `kind` is "none". `stablecoins`: the symbols config names (route.symbols). `proof.runs` is newest first. */
export function heroProof(proof: Proof, stablecoins: readonly string[], kind: HeroProofKind = 'latest-in'): HeroProof | null {
  if (kind === 'none') return null;
  for (const run of proof.runs) {
    if (!run.ok || !HERO_PROOF_FLOWS.includes(run.flow)) continue;
    const m = AMOUNT.exec(run.amount);
    if (!m || !stablecoins.includes(m[3]!)) continue;
    const chain = m[2]!.toLowerCase();
    const bch = run.txids.find((x) => x.chain === 'bch');
    const evm = run.txids.find((x) => x.chain === chain);
    if (!bch || !evm) continue;
    return { utc: run.utc, amount: m[1]!, symbol: m[3]!, chain, seconds: run.seconds, bch, evm };
  }
  return null;
}
