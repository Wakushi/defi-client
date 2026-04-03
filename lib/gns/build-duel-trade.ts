import { getAddress, type Address } from "viem";

import type { GnsTrade } from "@/types/gns-trade";
import type { DuelTradeSideConfig } from "@/types/duel-trade";

const EXAMPLE_OPEN_PRICE = BigInt("668209500000000");
const EXAMPLE_POSITION_500_USDC = BigInt("74826832004034672");
const EXAMPLE_COLLATERAL = BigInt("500000000");
const COLLATERAL_UINT120_MAX = (BigInt(1) << BigInt(120)) - BigInt(1);

/**
 * Trade Gains pour un duel : collatéral = mise USDC du duel, reste depuis la config joueur.
 * `leverageX` 10 → champ on-chain `leverage` 10_000 (même convention que le test hardcodé).
 */
export function buildGnsTradeFromDuelConfig(
  userRaw: string,
  collateralWei: bigint,
  side: DuelTradeSideConfig,
): GnsTrade {
  const user = getAddress(userRaw as Address);

  if (collateralWei <= BigInt(0)) {
    throw new Error("collateralAmountWei must be positive.");
  }
  if (collateralWei > COLLATERAL_UINT120_MAX) {
    throw new Error("collateralAmountWei exceeds uint120.");
  }

  const pairIndex = Math.floor(Number(side.pairIndex));
  if (!Number.isFinite(pairIndex) || pairIndex < 0 || pairIndex > 65535) {
    throw new Error("pairIndex invalide.");
  }

  const levX = Number(side.leverageX);
  if (!Number.isFinite(levX) || levX < 1 || levX > 500) {
    throw new Error("leverageX doit être entre 1 et 500.");
  }
  const leverage = Math.floor(levX * 1000);

  const positionSizeToken =
    (EXAMPLE_POSITION_500_USDC * collateralWei) / EXAMPLE_COLLATERAL;

  return {
    user,
    index: 0,
    pairIndex,
    leverage,
    long: Boolean(side.long),
    isOpen: true,
    collateralIndex: 3,
    tradeType: side.tradeType ?? 0,
    collateralAmount: collateralWei,
    openPrice: EXAMPLE_OPEN_PRICE,
    tp: BigInt(0),
    sl: BigInt(0),
    isCounterTrade: false,
    positionSizeToken,
    __placeholder: BigInt(0),
  };
}
