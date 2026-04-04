import {
  filterMainnetPortfolioPositions,
  sumPositionsEstimatedUsd,
} from "@/lib/mobula/duel-mainnet-chains";
import {
  flattenMobulaAssets,
  parseMobulaPortfolioBody,
} from "@/lib/mobula/normalize-portfolio";
import type { MobulaPortfolioPayload } from "@/types/mobula-portfolio";

const MOBULA_API = "https://api.mobula.io";
const MOBULA_DEMO = "https://demo-api.mobula.io";

export type FetchMobulaPortfolioOptions = {
  wallet: string;
  /**
   * Mode duel / fonds réels : ne pas demander les testnets à Mobula et n’agréger que les
   * positions sur des chain IDs mainnet connus (exclut Arbitrum Sepolia, etc.).
   */
  mainnetOnly?: boolean;
};

/**
 * Appelle Mobula `/api/1/wallet/portfolio`.
 * Sans `MOBULA_API_KEY`, utilise l’hôte démo (limité).
 */
export async function fetchMobulaWalletPortfolio(
  options: FetchMobulaPortfolioOptions,
): Promise<MobulaPortfolioPayload> {
  const mainnetOnly = options.mainnetOnly === true;
  const apiKey = process.env.MOBULA_API_KEY?.trim();
  const base = apiKey ? MOBULA_API : MOBULA_DEMO;

  const url = new URL(`${base}/api/1/wallet/portfolio`);
  url.searchParams.set("wallet", options.wallet);
  url.searchParams.set("cache", "false");
  url.searchParams.set("accuracy", "maximum");

  const minLiq = process.env.MOBULA_MIN_LIQ_USD?.trim();
  if (minLiq !== undefined && minLiq !== "") {
    url.searchParams.set("minliq", minLiq);
  } else {
    url.searchParams.set("minliq", "0");
  }

  const blockchains = process.env.MOBULA_BLOCKCHAINS?.trim();
  if (blockchains) {
    url.searchParams.set("blockchains", blockchains);
  } else if (mainnetOnly) {
    // Default to the chains we support for duels
    url.searchParams.set("blockchains", "arbitrum,base,ethereum");
  }

  if (!mainnetOnly && process.env.MOBULA_TESTNET === "true") {
    url.searchParams.set("testnet", "true");
  }

  if (process.env.MOBULA_FETCH_ALL_CHAINS === "true") {
    url.searchParams.set("fetchAllChains", "true");
  }

  const headers = new Headers();
  if (apiKey) {
    headers.set("Authorization", apiKey);
  }

  const res = await fetch(url.toString(), {
    headers,
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Mobula portfolio HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
    );
  }

  const json: unknown = await res.json();
  const parsed = parseMobulaPortfolioBody(json);
  if (!parsed) {
    throw new Error("Mobula portfolio: unexpected response.");
  }

  let positions = flattenMobulaAssets(parsed.assets);
  let total = parsed.total_wallet_balance;

  if (mainnetOnly) {
    positions = filterMainnetPortfolioPositions(positions);
    total = sumPositionsEstimatedUsd(positions);
  }

  return {
    wallet: parsed.wallet || options.wallet,
    totalWalletBalanceUsd: total,
    positions,
  };
}
