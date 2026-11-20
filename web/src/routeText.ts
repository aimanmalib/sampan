// Page text for the crossing claims of core/route-claims.ts: who carries a crossing and which assets go where, in the
// page's language. Every name comes from config (chains) or lang (routes, joining words); none is written here.
import { symbolList } from '../../core/flows';
import type { CrossRoute } from '../../core/cross-choices';
import type { claimsFor } from '../../core/route-claims';
import type { TextKey } from './i18n';

type T = (key: TextKey, vars?: Record<string, string>) => string;

/** "THORChain" or "THORChain or NEAR Intents". */
export const routeNames = (t: T, routes: readonly CrossRoute[]): string => symbolList(routes.map((r) => t(`route.${r}` as TextKey)), t('text.or'));

/** "USDC on Ethereum and Base; USDT on BNB Smart Chain". */
export const assetPlaces = (t: T, list: ReturnType<typeof claimsFor>): string =>
  list.map((x) => t('how.adds.item', { symbol: x.symbol, chains: symbolList(x.chains, t('text.and')) })).join('; ');
