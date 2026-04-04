import type { Address } from "viem";

import { fetchMobulaWalletPortfolio } from "@/lib/mobula/fetch-wallet-portfolio";

const EPS = 1e-6;

export type JoinWalletUsdResult =
  | { ok: true; totalUsd: number }
  | { ok: false; totalUsd: number | null; error: string; httpStatus: number };

/**
 * Vérifie que la valeur estimée du wallet (Mobula, USD) couvre la mise USDC du duel.
 * Utilisé pour accepter un duel en mode « duel » (multi-chain).
 */
export async function assertWalletUsdCoversStake(
  wallet: Address,
  stakeUsdc: string,
): Promise<JoinWalletUsdResult> {
  const stake = Number(stakeUsdc);
  if (!Number.isFinite(stake) || stake <= 0) {
    return {
      ok: false,
      totalUsd: null,
      error: "Mise du duel invalide en base.",
      httpStatus: 500,
    };
  }

  try {
    const p = await fetchMobulaWalletPortfolio({ wallet, mainnetOnly: true });
    const total = p.totalWalletBalanceUsd;
    if (!Number.isFinite(total)) {
      return {
        ok: false,
        totalUsd: null,
        error: "Réponse portfolio sans total USD.",
        httpStatus: 502,
      };
    }
    if (total + EPS < stake) {
      return {
        ok: false,
        totalUsd: total,
        error: "Valeur du portefeuille insuffisante pour cette mise (USD).",
        httpStatus: 400,
      };
    }
    return { ok: true, totalUsd: total };
  } catch (e) {
    const msg =
      e instanceof Error
        ? e.message
        : "Impossible de joindre l’indexeur de portefeuille.";
    return {
      ok: false,
      totalUsd: null,
      error: `${msg} Configure MOBULA_API_KEY ou vérifie le réseau.`,
      httpStatus: 502,
    };
  }
}
