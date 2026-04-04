/** Chaînes supportées par l’API Duel DeFi (REST + WebSocket). */
export type GainsApiChain = "Testnet" | "Arbitrum" | "Base";

export type GainsTradingPair = {
  pairIndex: number;
  name: string;
  from: string;
  to: string;
  groupIndex: number;
  feeIndex: number;
  spreadP: number;
  price: number;
  price24hAgo: number;
  percentChange: number;
  logo: string;
};

export type GainsPositionUpdate = {
  pairIndex: number;
  leverage: number;
  long: boolean;
  openPrice: number;
  pnl: number;
  liquidationPrice: number;
};
