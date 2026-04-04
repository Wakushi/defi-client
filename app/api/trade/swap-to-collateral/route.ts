import { type NextRequest, NextResponse } from "next/server";
import { getAddress, parseUnits, type Address } from "viem";

import { getSessionFromRequest } from "@/lib/auth/session";
import { findUserById } from "@/lib/db/users";
import { authenticatedEvmClient } from "@/lib/dynamic/evm-client";
import { getArbitrumOneChainFromEnv } from "@/lib/gns/gains-exec-context";
import { UNISWAP_NATIVE_TOKEN } from "@/lib/uniswap/trade-gateway";
import { executeUniswapClassicSwapFlow } from "@/lib/uniswap/execute-classic-swap";

export const runtime = "nodejs";

const ARBITRUM_USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as const;
const ARBITRUM_CHAIN_ID = 42161;

/**
 * POST /api/trade/swap-to-collateral
 * Body: { tokenIn: string, stakeUsdc: string, chainId?: number }
 *
 * Swaps `tokenIn` → USDC on Arbitrum via Uniswap so the user has
 * enough collateral for their Gains duel trade.
 *
 * `stakeUsdc` is the human-readable USDC amount (e.g. "10" for 10 USDC).
 * We convert to raw units (6 decimals) and use EXACT_OUTPUT so the user
 * gets exactly the stake amount in USDC.
 *
 * Returns the swap result including txHash.
 */
export async function POST(request: NextRequest) {
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

  let body: Record<string, unknown>;
  try {
    const raw = await request.json();
    body = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const rawTokenIn = typeof body.tokenIn === "string" ? body.tokenIn.trim() : "";
  const stakeUsdc = typeof body.stakeUsdc === "string" ? body.stakeUsdc.trim() : "";
  const chainId = typeof body.chainId === "number" ? body.chainId : ARBITRUM_CHAIN_ID;

  if (!rawTokenIn) {
    return NextResponse.json({ error: "Missing tokenIn." }, { status: 400 });
  }
  if (!stakeUsdc || Number.isNaN(Number(stakeUsdc)) || Number(stakeUsdc) <= 0) {
    return NextResponse.json({ error: "Invalid stakeUsdc." }, { status: 400 });
  }

  // Mobula uses 0xeee…eee for native ETH, Uniswap expects 0x000…000
  const MOBULA_NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  const tokenIn =
    rawTokenIn.toLowerCase() === MOBULA_NATIVE ? UNISWAP_NATIVE_TOKEN : rawTokenIn;

  const tokenOut = ARBITRUM_USDC;

  // If tokenIn is already USDC, no swap needed
  try {
    if (
      tokenIn !== UNISWAP_NATIVE_TOKEN &&
      getAddress(tokenIn as Address) === getAddress(tokenOut)
    ) {
      return NextResponse.json({ noSwapNeeded: true });
    }
  } catch {
    return NextResponse.json({ error: "Invalid tokenIn address." }, { status: 400 });
  }

  // Convert human USDC to raw (6 decimals)
  const amountRaw = parseUnits(stakeUsdc, 6).toString();

  let chain;
  try {
    chain = getArbitrumOneChainFromEnv();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Arbitrum RPC not configured.";
    return NextResponse.json({ error: msg }, { status: 503 });
  }

  const authToken = process.env.DYNAMIC_AUTH_TOKEN;
  const environmentId = process.env.DYNAMIC_ENVIRONMENT_ID;
  if (!authToken || !environmentId) {
    return NextResponse.json(
      { error: "Dynamic server config missing." },
      { status: 500 },
    );
  }

  try {
    const evmClient = await authenticatedEvmClient({ authToken, environmentId });

    const result = await executeUniswapClassicSwapFlow({
      chain,
      chainId,
      tokenIn,
      tokenOut,
      amountStr: amountRaw,
      walletAddress: wallet,
      evmClient,
      slippageTolerance: 0.5,
      quoteType: "EXACT_OUTPUT",
    });

    return NextResponse.json({
      swapped: true,
      ...result,
    });
  } catch (e) {
    console.error("[swap-to-collateral]", e);
    const msg = e instanceof Error ? e.message : "Swap failed.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
