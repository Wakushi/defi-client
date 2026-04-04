/** Réponse normalisée pour l’UI (sélection actif + montant). */
export type MobulaPortfolioPosition = {
  id: string;
  symbol: string;
  name: string;
  logo: string | null;
  chainId: string;
  /** Libellé réseau Mobula si issu de `cross_chain_balances`. */
  chainLabel?: string;
  tokenAddress: string;
  balance: number;
  balanceRaw: string;
  decimals?: number;
  priceUsd: number;
  estimatedUsd: number;
};

export type MobulaPortfolioPayload = {
  wallet: string;
  totalWalletBalanceUsd: number;
  positions: MobulaPortfolioPosition[];
  /** Solde lu sur le RPC faucet (GNS_COLLATERAL / USDC getFreeDai) car Mobula est vide ou en erreur. */
  usedOnchainFallback?: boolean;
  mobulaSkippedReason?:
    | "mobula_error"
    | "mobula_empty"
    | "friendly_hub_testnet_only";
  /** Requête `?playMode=` sur GET portfolio. */
  hubPlayMode?: "friendly" | "duel";
  /** Chaîne Gains / faucet (FAUCET_CHAIN_ID) pour filtrer les swaps Uniswap côté UI. */
  faucetChainId?: number;
  /** Adresse du jeton collatéral Gains (GNS_COLLATERAL_TOKEN_ADDRESS), pour masquer le swap inutile. */
  gainsCollateralTokenAddress?: string;
};
