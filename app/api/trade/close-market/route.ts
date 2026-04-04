import { NextRequest, NextResponse } from "next/server";
import { getAddress } from "viem";

import { getSessionFromRequest } from "@/lib/auth/session";
import { authenticatedEvmClient } from "@/lib/dynamic/evm-client";
import { findUserById } from "@/lib/db/users";
import { isFaucetChainConfigured } from "@/lib/evm/faucet-chain";
import { usdDecimalToGainsPriceUint64 } from "@/lib/gns/gains-price-precision";
import { sendGnsCloseTradeMarket } from "@/lib/gns/send-close-trade-market";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isFaucetChainConfigured()) {
    return NextResponse.json(
      { error: "FAUCET_RPC_URL and FAUCET_CHAIN_ID must be set (same chain as Gains)." },
      { status: 500 },
    );
  }

  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};

  const tradeIndexRaw = b.tradeIndex;
  const priceRaw = b.currentPriceUsdDecimaled;

  const tradeIndex =
    typeof tradeIndexRaw === "number"
      ? tradeIndexRaw
      : typeof tradeIndexRaw === "string"
        ? Number.parseInt(tradeIndexRaw, 10)
        : NaN;

  if (!Number.isInteger(tradeIndex) || tradeIndex < 0 || tradeIndex > 0xffff_ffff) {
    return NextResponse.json(
      { error: "tradeIndex must be an integer uint32 (WebSocket field `index`)." },
      { status: 400 },
    );
  }

  if (typeof priceRaw !== "number" || !Number.isFinite(priceRaw)) {
    return NextResponse.json(
      {
        error:
          "currentPriceUsdDecimaled must be a finite number (WebSocket `currentPriceUsdDecimaled`).",
      },
      { status: 400 },
    );
  }

  let expectedPriceUint64: bigint;
  try {
    expectedPriceUint64 = usdDecimalToGainsPriceUint64(priceRaw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Invalid price.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const user = await findUserById(session.userId);
  if (!user || user.pseudo !== session.pseudo) {
    return NextResponse.json({ error: "Session invalid." }, { status: 401 });
  }

  if (!user.wallet_address) {
    return NextResponse.json(
      { error: "User has no wallet_address." },
      { status: 400 },
    );
  }

  const authToken = process.env.DYNAMIC_AUTH_TOKEN;
  const environmentId = process.env.DYNAMIC_ENVIRONMENT_ID;
  if (!authToken || !environmentId) {
    return NextResponse.json(
      { error: "Dynamic server env missing." },
      { status: 500 },
    );
  }

  let walletAddress: `0x${string}`;
  try {
    walletAddress = getAddress(user.wallet_address as `0x${string}`);
  } catch {
    return NextResponse.json(
      { error: "Invalid wallet_address in database." },
      { status: 500 },
    );
  }

  try {
    const evmClient = await authenticatedEvmClient({
      authToken,
      environmentId,
    });

    const txHash = await sendGnsCloseTradeMarket({
      evmClient,
      walletAddress,
      tradeIndex,
      expectedPriceUint64,
    });

    return NextResponse.json({
      txHash,
      tradeIndex,
      expectedPriceUint64: expectedPriceUint64.toString(),
    });
  } catch (e) {
    console.error("[gns] closeTradeMarket failed:", e);
    return NextResponse.json(
      {
        error:
          e instanceof Error ? e.message : "closeTradeMarket failed (check server logs).",
      },
      { status: 502 },
    );
  }
}
