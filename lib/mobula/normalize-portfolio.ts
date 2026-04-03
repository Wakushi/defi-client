import type { MobulaPortfolioPosition } from "@/types/mobula-portfolio";

type RawCrossEntry = {
  address?: string;
  balance?: number;
  balanceRaw?: string;
  chainId?: string | number;
};

type RawAsset = {
  asset?: {
    name?: string;
    symbol?: string;
    logo?: string | null;
  };
  price?: number;
  contracts_balances?: Array<{
    address?: string;
    balance?: number;
    balanceRaw?: string;
    chainId?: string | number;
    decimals?: number;
  }>;
  cross_chain_balances?: Record<string, RawCrossEntry>;
};

function chainIdToString(c: string | number | undefined): string {
  if (c === undefined) return "unknown";
  return String(c);
}

export function flattenMobulaAssets(assets: RawAsset[]): MobulaPortfolioPosition[] {
  const out: MobulaPortfolioPosition[] = [];

  for (const a of assets) {
    const sym = a.asset?.symbol?.trim() || "?";
    const name = a.asset?.name?.trim() || sym;
    const logo = a.asset?.logo ?? null;
    const price = typeof a.price === "number" && Number.isFinite(a.price) ? a.price : 0;

    const entries: Array<{
      address: string;
      balance: number;
      balanceRaw: string;
      chainId: string;
      chainLabel?: string;
      decimals?: number;
    }> = [];

    if (Array.isArray(a.contracts_balances) && a.contracts_balances.length > 0) {
      for (const cb of a.contracts_balances) {
        if (!cb?.address) continue;
        const bal = Number(cb.balance);
        if (!Number.isFinite(bal) || bal <= 0) continue;
        entries.push({
          address: cb.address,
          balance: bal,
          balanceRaw: String(cb.balanceRaw ?? ""),
          chainId: chainIdToString(cb.chainId),
          decimals: cb.decimals,
        });
      }
    } else if (a.cross_chain_balances && typeof a.cross_chain_balances === "object") {
      for (const [label, cb] of Object.entries(a.cross_chain_balances)) {
        if (!cb?.address) continue;
        const bal = Number(cb.balance);
        if (!Number.isFinite(bal) || bal <= 0) continue;
        entries.push({
          address: cb.address,
          balance: bal,
          balanceRaw: String(cb.balanceRaw ?? ""),
          chainId: chainIdToString(cb.chainId),
          chainLabel: label,
        });
      }
    }

    for (const e of entries) {
      const id = `${sym}-${e.chainId}-${e.address.toLowerCase()}`;
      const estimatedUsd = e.balance * price;
      out.push({
        id,
        symbol: sym,
        name,
        logo,
        chainId: e.chainId,
        chainLabel: e.chainLabel,
        tokenAddress: e.address,
        balance: e.balance,
        balanceRaw: e.balanceRaw,
        decimals: e.decimals,
        priceUsd: price,
        estimatedUsd: Number.isFinite(estimatedUsd) ? estimatedUsd : 0,
      });
    }
  }

  out.sort((x, y) => y.estimatedUsd - x.estimatedUsd);
  return out;
}

export function parseMobulaPortfolioBody(body: unknown): {
  total_wallet_balance: number;
  wallet: string;
  assets: RawAsset[];
} | null {
  if (!body || typeof body !== "object") return null;
  const root = body as { data?: unknown };
  const data = root.data;
  if (!data || typeof data !== "object") return null;
  const d = data as {
    total_wallet_balance?: unknown;
    wallet?: unknown;
    assets?: unknown;
  };
  const wallet = typeof d.wallet === "string" ? d.wallet : "";
  const total =
    typeof d.total_wallet_balance === "number" && Number.isFinite(d.total_wallet_balance)
      ? d.total_wallet_balance
      : 0;
  if (!Array.isArray(d.assets)) return null;
  return {
    total_wallet_balance: total,
    wallet,
    assets: d.assets as RawAsset[],
  };
}
