import { getAddress, type Address } from "viem";

import type { GnsTrade } from "@/types/gns-trade";

/**
 * Hardcoded test trade (Arbitrum Sepolia Gains).
 * Scales `positionSizeToken` from your 500 USDC example to a smaller collateral.
 */
const EXAMPLE_OPEN_PRICE = BigInt("668209500000000");
const EXAMPLE_POSITION_500_USDC = BigInt("74826832004034672");
const EXAMPLE_COLLATERAL = BigInt("500000000");

/** 10 USDC (6 decimals) — valeur par défaut si l’API ne reçoit pas de montant. */
export const DEFAULT_TEST_COLLATERAL_AMOUNT = BigInt("10000000");

const COLLATERAL_UINT120_MAX = (BigInt(1) << BigInt(120)) - BigInt(1);

/**
 * Même logique que l’exemple 500 USDC : `positionSizeToken` proportionnel au collatéral.
 */
export function buildHardcodedTestTrade(
  userRaw: string,
  collateralAmountWei: bigint = DEFAULT_TEST_COLLATERAL_AMOUNT,
): GnsTrade {
  const user = getAddress(userRaw as Address);

  if (collateralAmountWei <= BigInt(0)) {
    throw new Error("collateralAmountWei must be positive.");
  }
  if (collateralAmountWei > COLLATERAL_UINT120_MAX) {
    throw new Error("collateralAmountWei exceeds uint120.");
  }

  const positionSizeToken =
    (EXAMPLE_POSITION_500_USDC * collateralAmountWei) / EXAMPLE_COLLATERAL;

  return {
    user,
    index: 0,
    pairIndex: 0,
    leverage: 10_000,
    long: true,
    isOpen: true,
    collateralIndex: 3,
    tradeType: 0,
    collateralAmount: collateralAmountWei,
    openPrice: EXAMPLE_OPEN_PRICE,
    tp: BigInt(0),
    sl: BigInt(0),
    isCounterTrade: false,
    positionSizeToken,
    __placeholder: BigInt(0),
  };
}
