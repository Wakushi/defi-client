import type { GainsApiChain } from "@/types/gains-api";

/** Paramètres de trade Gains côté joueur (stockés en JSON sur le duel). */
export type DuelTradeSideConfig = {
  pairIndex: number;
  /** Levier affiché (ex. 10 pour 10×). */
  leverageX: number;
  long: boolean;
  /** Marché par défaut. */
  tradeType?: number;
  /**
   * Prix de référence (ex. quote USD depuis GET /gains/pairs) au moment du ready.
   * Sert à encoder `openPrice` on-chain (précision GNS ~1e10). Sans ce champ, un prix
   * de démo obsolète provoque souvent un revert à l’ouverture.
   */
  referencePrice?: number;
  /** Chaîne choisie dans le picker (exécute-trade + close sur le même réseau). */
  gainsChain?: GainsApiChain;
};
