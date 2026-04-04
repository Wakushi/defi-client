import type { DynamicEvmWalletClient } from "@dynamic-labs-wallet/node-evm";
import type { Address, Chain } from "viem";

import { dynamicSignTypedData } from "@/lib/evm/dynamic-sign-typed-data";
import { dynamicSignAndSendUniswapTx } from "@/lib/evm/dynamic-sign-send";
import { permitDataToSignTypedDataParams } from "@/lib/uniswap/permit-to-viem-typed-data";
import {
  isValidUniswapTx,
  UNISWAP_NATIVE_TOKEN,
  UNISWAP_ROUTING_USES_POST_SWAP,
  uniswapPostJson,
  type UniswapApprovalResponse,
  type UniswapQuoteResponse,
  type UniswapSwapResponse,
} from "@/lib/uniswap/trade-gateway";

export type ClassicSwapFlowResult = {
  cancelTxHash?: string;
  approvalTxHash?: string;
  permitOnChainTxHash?: string;
  swapTxHash: string;
  requestId?: string;
  routing?: string;
};

/**
 * Flux Uniswap Trading API : check_approval (ERC-20) → quote → permit (si besoin) → /swap → diffusion.
 * `chain` doit correspondre à `chainId` (même réseau que les transactions renvoyées par l’API).
 */
export async function executeUniswapClassicSwapFlow(params: {
  chain: Chain;
  chainId: number;
  tokenIn: string;
  tokenOut: string;
  amountStr: string;
  walletAddress: Address;
  evmClient: DynamicEvmWalletClient;
  slippageTolerance?: number;
  /** "EXACT_INPUT" (default) or "EXACT_OUTPUT". */
  quoteType?: "EXACT_INPUT" | "EXACT_OUTPUT";
}): Promise<ClassicSwapFlowResult> {
  const slippage = params.slippageTolerance ?? 0.5;
  const quoteHeaders: Record<string, string> = {};
  if (params.tokenIn === UNISWAP_NATIVE_TOKEN) {
    quoteHeaders["x-erc20eth-enabled"] = "true";
  }

  const out: ClassicSwapFlowResult = { swapTxHash: "" };

  if (params.tokenIn !== UNISWAP_NATIVE_TOKEN) {
    const approvalRes = await uniswapPostJson<UniswapApprovalResponse>(
      "/check_approval",
      {
        walletAddress: params.walletAddress,
        token: params.tokenIn,
        amount: params.amountStr,
        chainId: params.chainId,
      },
    );

    if (isValidUniswapTx(approvalRes.cancel ?? undefined)) {
      out.cancelTxHash = await dynamicSignAndSendUniswapTx({
        evmClient: params.evmClient,
        walletAddress: params.walletAddress,
        tx: approvalRes.cancel!,
        chain: params.chain,
      });
    }

    if (isValidUniswapTx(approvalRes.approval ?? undefined)) {
      out.approvalTxHash = await dynamicSignAndSendUniswapTx({
        evmClient: params.evmClient,
        walletAddress: params.walletAddress,
        tx: approvalRes.approval!,
        chain: params.chain,
      });
    }
  }

  const quoteType = params.quoteType ?? "EXACT_INPUT";

  const quoteRes = await uniswapPostJson<UniswapQuoteResponse>(
    "/quote",
    {
      type: quoteType,
      amount: params.amountStr,
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      tokenInChainId: params.chainId,
      tokenOutChainId: params.chainId,
      swapper: params.walletAddress,
      slippageTolerance: slippage,
      permitAmount: "FULL",
      routingPreference: "BEST_PRICE",
      protocols: ["V3", "V2", "V4"],
    },
    quoteHeaders,
  );

  out.requestId = quoteRes.requestId;
  out.routing = quoteRes.routing;

  if (!UNISWAP_ROUTING_USES_POST_SWAP.has(quoteRes.routing)) {
    throw new Error(
      `Routage ${quoteRes.routing} non pris en charge (UniswapX / hors /swap). ` +
        "Essayez un autre montant ou attendez un itinéraire classique.",
    );
  }

  if (isValidUniswapTx(quoteRes.permitTransaction ?? undefined)) {
    out.permitOnChainTxHash = await dynamicSignAndSendUniswapTx({
      evmClient: params.evmClient,
      walletAddress: params.walletAddress,
      tx: quoteRes.permitTransaction!,
      chain: params.chain,
    });
  }

  let signature: `0x${string}` | undefined;
  if (quoteRes.permitData) {
    const typed = permitDataToSignTypedDataParams(quoteRes.permitData);
    signature = await dynamicSignTypedData({
      evmClient: params.evmClient,
      walletAddress: params.walletAddress,
      typedData: typed,
    });
  }

  const swapPayload: Record<string, unknown> = {
    quote: quoteRes.quote,
    refreshGasPrice: true,
  };
  if (quoteRes.permitData) {
    if (!signature) {
      throw new Error("Échec de la signature Permit2.");
    }
    swapPayload.signature = signature;
    swapPayload.permitData = quoteRes.permitData;
  }

  const swapRes = await uniswapPostJson<UniswapSwapResponse>("/swap", swapPayload);

  if (!isValidUniswapTx(swapRes.swap)) {
    throw new Error("Invalid /swap response (empty data).");
  }

  out.swapTxHash = await dynamicSignAndSendUniswapTx({
    evmClient: params.evmClient,
    walletAddress: params.walletAddress,
    tx: swapRes.swap,
    chain: params.chain,
  });

  return out;
}
