import type { DynamicEvmWalletClient } from "@dynamic-labs-wallet/node-evm";
import { encodeFunctionData, type Address, type Chain } from "viem";

import { gnsTradeAbi } from "@/constants/gnsTrade";
import { dynamicSignAndSendTransaction } from "@/lib/evm/dynamic-sign-send";
import type { GnsTrade } from "@/types/gns-trade";

const DEFAULT_MAX_SLIPPAGE_P = 3000;

function tradeToTuple(t: GnsTrade) {
  return {
    user: t.user,
    index: t.index,
    pairIndex: t.pairIndex,
    leverage: t.leverage,
    long: t.long,
    isOpen: t.isOpen,
    collateralIndex: t.collateralIndex,
    tradeType: t.tradeType,
    collateralAmount: t.collateralAmount,
    openPrice: t.openPrice,
    tp: t.tp,
    sl: t.sl,
    isCounterTrade: t.isCounterTrade,
    positionSizeToken: t.positionSizeToken,
    __placeholder: t.__placeholder,
  };
}

/**
 * `openTrade` on Gains diamond — Dynamic MPC signing.
 * Call {@link approveCollateralIfNeeded} first.
 */
export async function sendGnsOpenTrade(params: {
  evmClient: DynamicEvmWalletClient;
  walletAddress: Address;
  trade: GnsTrade;
  chain: Chain;
  diamond: Address;
}): Promise<`0x${string}`> {
  const referrer = (
    process.env.GNS_REFERRER_ADDRESS?.startsWith("0x")
      ? process.env.GNS_REFERRER_ADDRESS
      : "0x0000000000000000000000000000000000000000"
  ) as Address;

  const maxSlippageP = Number(process.env.GNS_MAX_SLIPPAGE_P) || DEFAULT_MAX_SLIPPAGE_P;

  const data = encodeFunctionData({
    abi: gnsTradeAbi,
    functionName: "openTrade",
    args: [
      tradeToTuple(params.trade),
      maxSlippageP,
      referrer,
    ],
  });

  const t = params.trade;
  console.log("[Gains openTrade]", {
    contract: params.diamond,
    wallet: params.walletAddress,
    pairIndex: t.pairIndex,
    leverage: t.leverage,
    long: t.long,
    collateralIndex: t.collateralIndex,
    tradeType: t.tradeType,
    collateralAmount: t.collateralAmount.toString(),
    openPrice: t.openPrice.toString(),
    positionSizeToken: t.positionSizeToken.toString(),
    maxSlippageP,
    referrer,
    calldataBytes: data.length,
  });

  const hash = await dynamicSignAndSendTransaction({
    evmClient: params.evmClient,
    walletAddress: params.walletAddress,
    to: params.diamond,
    data,
    chain: params.chain,
  });

  console.log("[Gains openTrade] txHash", hash);

  return hash;
}
