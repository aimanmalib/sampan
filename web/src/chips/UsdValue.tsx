// "≈ US$1.73" beside an amount's label, from numbers the page already has (PUSD counts as one US dollar; a BCH amount
// is valued at the price the quote gave). Formatted for the visitor's language, so it needs no text of its own.
import { useText } from '../i18n';

export function UsdValue({ usd }: { usd: number | undefined }) {
  const { lang } = useText();
  if (usd === undefined || !Number.isFinite(usd) || usd <= 0) return null;
  const value = new Intl.NumberFormat(lang, { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', maximumFractionDigits: 2 }).format(usd);
  return (
    <span className="field__usd" aria-hidden="true">
      ≈ {value}
    </span>
  );
}
