import { getAddress, type Address } from "viem";

import type { GnsTrade } from "@/types/gns-trade";
import type { DuelTradeSideConfig } from "@/types/duel-trade";

const EXAMPLE_OPEN_PRICE = BigInt("668209500000000");
const EXAMPLE_POSITION_500_USDC = BigInt("74826832004034672");
const EXAMPLE_COLLATERAL = BigInt("500000000");
const COLLATERAL_UINT120_MAX = (BigInt(1) << BigInt(120)) - BigInt(1);

/** Précision prix Gains / gTrade (souvent 10 décimales pour les paires USD). */
const OPEN_PRICE_SCALE = BigInt(10 ** 10);

/**
 * Convertit un prix « humain » (ex. 67500.12 depuis l’API paires) en uint64 on-chain.
 * Si la conversion échoue, retourne l’ancien exemple (risque de revert si trop éloigné du marché).
 */
const MAX_U64 = BigInt("18446744073709551615");

export function referencePriceToOpenPrice(referencePrice: number): bigint {
  if (!Number.isFinite(referencePrice) || referencePrice <= 0) {
    return EXAMPLE_OPEN_PRICE;
  }
  const scaled = referencePrice * Number(OPEN_PRICE_SCALE);
  if (!Number.isFinite(scaled) || scaled <= 0 || scaled > Number.MAX_SAFE_INTEGER) {
    return EXAMPLE_OPEN_PRICE;
  }
  const out = BigInt(Math.round(scaled));
  if (out > MAX_U64) {
    return EXAMPLE_OPEN_PRICE;
  }
  return out;
}

/**
 * Trade Gains pour un duel : collatéral = mise USDC du duel, reste depuis la config joueur.
 * `leverageX` 10 → champ on-chain `leverage` 10_000 (même convention que le test hardcodé).
 */
export function buildGnsTradeFromDuelConfig(
  userRaw: string,
  collateralWei: bigint,
  side: DuelTradeSideConfig,
  opts?: { collateralIndex?: number },
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
    throw new Error("leverageX must be between 1 and 500.");
  }
  const leverage = Math.floor(levX * 1000);

  const positionSizeToken =
    (EXAMPLE_POSITION_500_USDC * collateralWei) / EXAMPLE_COLLATERAL;

  const openPrice =
    side.referencePrice != null
      ? referencePriceToOpenPrice(side.referencePrice)
      : EXAMPLE_OPEN_PRICE;

  const collateralIndex =
    typeof opts?.collateralIndex === "number" &&
    Number.isInteger(opts.collateralIndex) &&
    opts.collateralIndex >= 0
      ? opts.collateralIndex
      : 3;

  return {
    user,
    index: 0,
    pairIndex,
    leverage,
    long: Boolean(side.long),
    isOpen: true,
    collateralIndex,
    tradeType: side.tradeType ?? 0,
    collateralAmount: collateralWei,
    openPrice,
    tp: BigInt(0),
    sl: BigInt(0),
    isCounterTrade: false,
    positionSizeToken,
    __placeholder: 0,
  };
}
