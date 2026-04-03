import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getAddress } from "viem";

import { getSessionFromRequest } from "@/lib/auth/session";
import { authenticatedEvmClient } from "@/lib/dynamic/evm-client";
import { findUserById } from "@/lib/db/users";
import { approveCollateralIfNeeded } from "@/lib/gns/approve-collateral-if-needed";
import { buildHardcodedTestTrade } from "@/lib/gns/build-test-trade";
import { sendGnsOpenTrade } from "@/lib/gns/send-open-trade";
import { isFaucetChainConfigured } from "@/lib/evm/faucet-chain";

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

  const password =
    typeof body === "object" &&
    body !== null &&
    "password" in body &&
    typeof (body as { password: unknown }).password === "string"
      ? (body as { password: string }).password
      : "";

  if (!password) {
    return NextResponse.json(
      { error: "password is required (Dynamic wallet signing)." },
      { status: 400 },
    );
  }

  const user = await findUserById(session.userId);
  if (!user || user.pseudo !== session.pseudo) {
    return NextResponse.json({ error: "Session invalid." }, { status: 401 });
  }

  const passwordOk = await bcrypt.compare(password, user.password_hash);
  if (!passwordOk) {
    return NextResponse.json({ error: "Invalid password." }, { status: 401 });
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

  const trade = buildHardcodedTestTrade(walletAddress);
  const minAllowance = trade.collateralAmount + BigInt(1);

  try {
    const evmClient = await authenticatedEvmClient({
      authToken,
      environmentId,
    });

    const approveTxHash = await approveCollateralIfNeeded({
      evmClient,
      walletAddress,
      password,
      minAmount: minAllowance,
    });

    const txHash = await sendGnsOpenTrade({
      evmClient,
      walletAddress,
      password,
      trade,
    });
    return NextResponse.json({
      txHash,
      ...(approveTxHash ? { approveTxHash } : {}),
      trade: serializeTradeForJson(trade),
    });
  } catch (e) {
    console.error("[gns] openTrade failed:", e);
    return NextResponse.json(
      {
        error:
          e instanceof Error ? e.message : "openTrade failed (check server logs).",
      },
      { status: 502 },
    );
  }
}

function serializeTradeForJson(t: import("@/types/gns-trade").GnsTrade) {
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
