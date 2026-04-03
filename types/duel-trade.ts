/** Paramètres de trade Gains côté joueur (stockés en JSON sur le duel). */
export type DuelTradeSideConfig = {
  pairIndex: number;
  /** Levier affiché (ex. 10 pour 10×). */
  leverageX: number;
  long: boolean;
  /** Marché par défaut. */
  tradeType?: number;
};
