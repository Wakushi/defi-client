import type { DynamicEvmWalletClient } from "@dynamic-labs-wallet/node-evm";
import { encodeFunctionData, type Address } from "viem";

import {
  CONTRACT_GAINS_ARBITRUM_SEPOLIA,
  gnsTradeAbi,
} from "@/constants/gnsTrade";
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
    __placeholder: Number(t.__placeholder),
  };
}

/**
 * `openTrade` on Gains diamond — Dynamic MPC signing.
 * Call {@link approveCollateralIfNeeded} first.
 */
export async function sendGnsOpenTrade(params: {
  evmClient: DynamicEvmWalletClient;
  walletAddress: Address;
  password: string;
  trade: GnsTrade;
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

  return dynamicSignAndSendTransaction({
    evmClient: params.evmClient,
    walletAddress: params.walletAddress,
    password: params.password,
    to: CONTRACT_GAINS_ARBITRUM_SEPOLIA,
    data,
  });
}
