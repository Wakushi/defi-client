import type { DynamicEvmWalletClient } from "@dynamic-labs-wallet/node-evm";
import { encodeFunctionData, type Address } from "viem";

import {
  CONTRACT_GAINS_ARBITRUM_SEPOLIA,
  gnsTradeAbi,
} from "@/constants/gnsTrade";
import { dynamicSignAndSendTransaction } from "@/lib/evm/dynamic-sign-send";

/**
 * `closeTradeMarket` sur le diamond Gains — `_index` = index de trade côté storage (ex. champ WS `index`).
 */
export async function sendGnsCloseTradeMarket(params: {
  evmClient: DynamicEvmWalletClient;
  walletAddress: Address;
  tradeIndex: number;
  expectedPriceUint64: bigint;
}): Promise<`0x${string}`> {
  const { tradeIndex, expectedPriceUint64 } = params;

  if (!Number.isInteger(tradeIndex) || tradeIndex < 0 || tradeIndex > 0xffff_ffff) {
    throw new Error("tradeIndex must be a uint32.");
  }

  const data = encodeFunctionData({
    abi: gnsTradeAbi,
    functionName: "closeTradeMarket",
    args: [tradeIndex, expectedPriceUint64],
  });

  console.log("[Gains closeTradeMarket]", {
    contract: CONTRACT_GAINS_ARBITRUM_SEPOLIA,
    wallet: params.walletAddress,
    tradeIndex,
    expectedPrice: expectedPriceUint64.toString(),
  });

  const hash = await dynamicSignAndSendTransaction({
    evmClient: params.evmClient,
    walletAddress: params.walletAddress,
    to: CONTRACT_GAINS_ARBITRUM_SEPOLIA,
    data,
  });

  console.log("[Gains closeTradeMarket] txHash", hash);

  return hash;
}
