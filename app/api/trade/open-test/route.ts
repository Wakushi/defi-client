import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createPublicClient, getAddress, http } from "viem";

import { erc20Abi } from "@/constants/erc20";
import { getSessionFromRequest } from "@/lib/auth/session";
import { authenticatedEvmClient } from "@/lib/dynamic/evm-client";
import { findUserById } from "@/lib/db/users";
import { getFaucetChain, isFaucetChainConfigured } from "@/lib/evm/faucet-chain";
import {
  approveCollateralIfNeeded,
  getGnsCollateralTokenAddress,
} from "@/lib/gns/approve-collateral-if-needed";
import { buildHardcodedTestTrade } from "@/lib/gns/build-test-trade";
import { sendGnsOpenTrade } from "@/lib/gns/send-open-trade";

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

  const password = typeof b.password === "string" ? b.password : "";
  const collateralAmountRaw =
    typeof b.collateralAmountRaw === "string" ? b.collateralAmountRaw.trim() : "";
  const tokenAddressIn =
    typeof b.tokenAddress === "string" ? b.tokenAddress.trim() : "";

  if (!password) {
    return NextResponse.json(
      { error: "password is required (Dynamic wallet signing)." },
      { status: 400 },
    );
  }

  if (!collateralAmountRaw || !tokenAddressIn) {
    return NextResponse.json(
      {
        error:
          "collateralAmountRaw et tokenAddress sont requis (sélectionne un actif et un montant au-dessus).",
      },
      { status: 400 },
    );
  }

  let expectedCollateral: `0x${string}`;
  try {
    expectedCollateral = getGnsCollateralTokenAddress();
  } catch {
    return NextResponse.json(
      { error: "GNS_COLLATERAL_TOKEN_ADDRESS manquant côté serveur." },
      { status: 500 },
    );
  }

  let tokenAddress: `0x${string}`;
  try {
    tokenAddress = getAddress(tokenAddressIn as `0x${string}`);
  } catch {
    return NextResponse.json({ error: "tokenAddress invalide." }, { status: 400 });
  }

  if (tokenAddress.toLowerCase() !== expectedCollateral.toLowerCase()) {
    return NextResponse.json(
      {
        error:
          "Le jeton sélectionné n’est pas le collatéral Gains (GNS_COLLATERAL_TOKEN_ADDRESS).",
      },
      { status: 400 },
    );
  }

  let collateralWei: bigint;
  try {
    collateralWei = BigInt(collateralAmountRaw);
  } catch {
    return NextResponse.json(
      { error: "collateralAmountRaw doit être un entier (unités du token)." },
      { status: 400 },
    );
  }

  if (collateralWei <= BigInt(0)) {
    return NextResponse.json(
      { error: "Le montant collatéral doit être strictement positif." },
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

  const chain = getFaucetChain();
  const publicClient = createPublicClient({
    chain,
    transport: http(chain.rpcUrls.default.http[0]),
  });

  let onChainBalance: bigint;
  try {
    onChainBalance = await publicClient.readContract({
      address: expectedCollateral,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [walletAddress],
    });
  } catch (e) {
    console.error("[gns] balanceOf collateral failed:", e);
    return NextResponse.json(
      { error: "Impossible de lire le solde du collatéral sur la chaîne faucet." },
      { status: 502 },
    );
  }

  if (onChainBalance < collateralWei) {
    return NextResponse.json(
      { error: "Solde collatéral insuffisant sur la chaîne du trade." },
      { status: 400 },
    );
  }

  let trade: ReturnType<typeof buildHardcodedTestTrade>;
  try {
    trade = buildHardcodedTestTrade(walletAddress, collateralWei);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Montant collatéral invalide.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

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
