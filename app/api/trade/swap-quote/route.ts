import { type NextRequest, NextResponse } from "next/server";
import { getAddress, type Address } from "viem";

import { getSessionFromRequest } from "@/lib/auth/session";
import { findUserById } from "@/lib/db/users";
import { getArbitrumOneChainFromEnv } from "@/lib/gns/gains-exec-context";
import {
  UNISWAP_NATIVE_TOKEN,
  uniswapPostJson,
  type UniswapQuoteResponse,
} from "@/lib/uniswap/trade-gateway";

export const runtime = "nodejs";

/** Arbitrum USDC (native). */
const ARBITRUM_USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as const;
const ARBITRUM_CHAIN_ID = 42161;

/**
 * GET /api/trade/swap-quote?tokenIn=0x…&amount=1000000&chainId=42161
 *
 * Read-only Uniswap quote: how much `tokenIn` is needed to get `amount` USDC
 * (EXACT_OUTPUT). Used by the TokenPicker to preview the swap cost.
 */
export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const user = await findUserById(session.userId);
  if (!user?.wallet_address) {
    return NextResponse.json({ error: "No wallet." }, { status: 400 });
  }

  let wallet: Address;
  try {
    wallet = getAddress(user.wallet_address.trim() as `0x${string}`);
  } catch {
    return NextResponse.json({ error: "Invalid wallet." }, { status: 500 });
  }

  const sp = request.nextUrl.searchParams;
  const tokenIn = sp.get("tokenIn")?.trim();
  const amount = sp.get("amount")?.trim(); // raw USDC units (6 decimals)
  const chainId = Number(sp.get("chainId") || ARBITRUM_CHAIN_ID);

  console.log("[swap-quote] params:", { tokenIn, amount, chainId, wallet });

  if (!tokenIn || !amount || !/^\d+$/.test(amount)) {
    console.log("[swap-quote] BAIL: missing or invalid tokenIn/amount");
    return NextResponse.json(
      { error: "Missing or invalid tokenIn / amount." },
      { status: 400 },
    );
  }

  // Validate chain is configured
  if (chainId === ARBITRUM_CHAIN_ID) {
    try {
      getArbitrumOneChainFromEnv();
    } catch (e) {
      console.log("[swap-quote] BAIL: Arbitrum RPC not configured", e);
      return NextResponse.json(
        { error: "Arbitrum RPC not configured." },
        { status: 503 },
      );
    }
  }

  // Mobula uses 0xeee…eee for native ETH, Uniswap expects 0x000…000
  const MOBULA_NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  const normalizedTokenIn =
    tokenIn.toLowerCase() === MOBULA_NATIVE ? UNISWAP_NATIVE_TOKEN : tokenIn;

  const tokenOut = ARBITRUM_USDC;

  // If tokenIn IS USDC, no swap needed
  try {
    if (getAddress(normalizedTokenIn as Address) === getAddress(tokenOut)) {
      console.log("[swap-quote] tokenIn is USDC, no swap needed");
      return NextResponse.json({ noSwapNeeded: true });
    }
  } catch {
    console.log("[swap-quote] tokenIn address parse failed, continuing anyway");
  }

  const quoteHeaders: Record<string, string> = {};
  if (normalizedTokenIn === UNISWAP_NATIVE_TOKEN) {
    quoteHeaders["x-erc20eth-enabled"] = "true";
  }

  const quotePayload = {
    type: "EXACT_OUTPUT",
    amount,
    tokenIn: normalizedTokenIn,
    tokenOut,
    tokenInChainId: chainId,
    tokenOutChainId: chainId,
    swapper: wallet,
    slippageTolerance: 0.5,
    routingPreference: "BEST_PRICE",
    protocols: ["V3", "V2", "V4"],
  };

  console.log("[swap-quote] Uniswap /quote payload:", JSON.stringify(quotePayload));

  try {
    const quoteRes = await uniswapPostJson<UniswapQuoteResponse>(
      "/quote",
      quotePayload,
      quoteHeaders,
    );

    console.log("[swap-quote] Uniswap /quote raw response:", JSON.stringify(quoteRes, null, 2));

    const quote = quoteRes.quote as Record<string, unknown> | undefined;
    const input = quote?.input as { amount?: string; token?: string } | undefined;
    const output = quote?.output as { amount?: string; token?: string } | undefined;

    console.log("[swap-quote] input:", JSON.stringify(input), "output:", JSON.stringify(output));

    return NextResponse.json({
      noSwapNeeded: false,
      routing: quoteRes.routing,
      requestId: quoteRes.requestId,
      amountIn: input?.amount ?? null,
      amountOut: output?.amount ?? null,
      tokenIn: input?.token ?? null,
      tokenOut: output?.token ?? null,
      gasEstimateUsd: quote?.gasFeeUSD ?? null,
      priceImpact: quote?.priceImpact ?? null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Quote failed.";
    console.error("[swap-quote] ERROR:", msg, e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
