import type { GnsTrade } from "@/types/gns-trade";

export function serializeTradeForJson(t: GnsTrade) {
  return {
    ...t,
    collateralAmount: t.collateralAmount.toString(),
    openPrice: t.openPrice.toString(),
    tp: t.tp.toString(),
    sl: t.sl.toString(),
    positionSizeToken: t.positionSizeToken.toString(),
    __placeholder: t.__placeholder.toString(),
  };
}
