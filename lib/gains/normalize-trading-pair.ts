import type { GainsTradingPair } from "@/types/gains-api";

function num(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Mappe une entrée API (camelCase ou snake_case) vers {@link GainsTradingPair}.
 * La variation 24h est dérivée de `price` / `price24hAgo` quand c’est possible,
 * car certains upstream envoient `percentChange: 0` ou un mauvais champ.
 */
export function normalizeTradingPair(raw: Record<string, unknown>): GainsTradingPair | null {
  const pairIndex = num(raw.pairIndex ?? raw.pair_index);
  if (!Number.isInteger(pairIndex)) return null;

  const name = String(raw.name ?? "");
  const from = String(raw.from ?? "");
  const to = String(raw.to ?? "");
  const groupIndex = num(raw.groupIndex ?? raw.group_index);
  const feeIndex = num(raw.feeIndex ?? raw.fee_index);
  const spreadP = num(raw.spreadP ?? raw.spread_p);
  const price = num(raw.price);
  const price24hAgo = num(
    raw.price24hAgo ?? raw.price_24h_ago ?? raw.price24H_Ago ?? raw.price_24h,
  );

  const rawPct = raw.percentChange ?? raw.percent_change ?? raw.change24h ?? raw.pct24h;
  const pctFromApi = num(rawPct);

  let percentChange = 0;
  if (Number.isFinite(price) && Number.isFinite(price24hAgo) && price24hAgo > 0) {
    percentChange = ((price - price24hAgo) / price24hAgo) * 100;
  } else if (Number.isFinite(pctFromApi)) {
    // Déjà en « points de pourcentage » (ex. 2.5 = 2,5 %)
    percentChange = pctFromApi;
  }

  return {
    pairIndex,
    name,
    from,
    to,
    groupIndex: Number.isFinite(groupIndex) ? groupIndex : 0,
    feeIndex: Number.isFinite(feeIndex) ? feeIndex : 0,
    spreadP: Number.isFinite(spreadP) ? spreadP : 0,
    price: Number.isFinite(price) ? price : 0,
    price24hAgo: Number.isFinite(price24hAgo) ? price24hAgo : 0,
    percentChange,
    logo: String(raw.logo ?? ""),
  };
}
